const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const account=process.env.CLOUDFLARE_ACCOUNT_ID,name='helium-authority-fixture-20261116',dir=path.resolve(process.argv[3]||'.worktrees/authority-pilot-private'),ledgerPath=path.join(dir,'cloud-ledger.json');
let ledger=fs.existsSync(ledgerPath)?JSON.parse(fs.readFileSync(ledgerPath)): {account,name,createdAt:new Date().toISOString(),http:3,rowsRead:0,rowsWritten:0,requests:[],resources:{},plan:'Workers Free attested; no subscription change',d1Quota:'Never-used user attestation, not directly measured'};
function save(){fs.writeFileSync(ledgerPath,JSON.stringify(ledger,null,2));}
async function api(method,route,body,isForm=false){if(++ledger.http>50)throw Error('Control-plane budget exhausted');ledger.requests.push({method,route:route.replace(account,'[account]'),issuedAt:new Date().toISOString()});save();const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+'/'+route,{method,headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,...(!isForm&&body?{'Content-Type':'application/json'}:{})},body:body?(isForm?body:JSON.stringify(body)):undefined,signal:AbortSignal.timeout(20000)});const result=await r.json();Object.assign(ledger.requests.at(-1),{status:r.status,success:result.success,errorCodes:result.errors?.map(e=>e.code)});save();if(!r.ok||!result.success)throw Error('Cloudflare '+r.status+' '+JSON.stringify(result.errors?.map(e=>({code:e.code}))).slice(0,700));return result.result;}
(async()=>{
 if(!process.env.CLOUDFLARE_API_TOKEN||!account)throw Error('Dedicated bootstrap token and explicit account required');if(ledger.account!==account)throw Error('Recorded account mismatch');
 const mode=process.argv[2];
 if(mode==='provision'||mode==='init-deploy'){
  if(mode==='provision'&&(ledger.resources.databaseId||ledger.createIssued))throw Error('Resource creation already issued; never retry blindly');
  if(mode==='init-deploy'&&(!ledger.resources.databaseId||ledger.workerUploadIssued))throw Error('Dedicated DB and no prior upload required');
  const bundle=fs.readFileSync(path.join(dir,'index.mjs')),setup=JSON.parse(fs.readFileSync(path.join(dir,'setup.private.json'))),local=JSON.parse(fs.readFileSync(path.join(dir,'local-validation.json'))),privateData=JSON.parse(fs.readFileSync(path.join(dir,'synthetic-secrets.private.json')));
  if(crypto.createHash('sha256').update(bundle).digest('hex')!==setup.hash||!local.allPassed||local.maxBytes>1048576||Date.now()>setup.expires-3600000)throw Error('Fresh tested bundle/setup required');
  if(mode==='provision'){ledger.createIssued=true;save();const db=await api('POST','d1/database',{name});ledger.resources.databaseId=db.uuid;ledger.resources.databaseName=db.name;save();}
  const db={uuid:ledger.resources.databaseId};
  if(ledger.setupInFlight)throw Error('Unknown previous SQL outcome; reconcile before resuming');
  for(let i=ledger.setupNext||0;i<setup.queries.length;i++){ledger.setupInFlight=i+1;save();const results=await api('POST','d1/database/'+db.uuid+'/query',setup.queries[i]);for(const r of results){if(!r.success)throw Error('Fixture setup failed');ledger.rowsRead+=r.meta.rows_read||0;ledger.rowsWritten+=r.meta.rows_written||0;ledger.databaseBytes=r.meta.size_after||ledger.databaseBytes;}ledger.setupNext=i+1;ledger.setupInFlight=null;save();}
  if(ledger.rowsRead>64||ledger.rowsWritten>128||ledger.databaseBytes>1048576)throw Error('Fixture setup budget exceeded');save();
  const metadata={main_module:'index.mjs',compatibility_date:'2026-10-19',compatibility_flags:['nodejs_compat'],bindings:[{type:'d1',name:'DB',id:db.uuid},...Object.entries(privateData.secrets).map(([key,text])=>({type:'secret_text',name:key,text}))],observability:{enabled:true,head_sampling_rate:1},logpush:false};
  const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.set('index.mjs',new Blob([bundle],{type:'application/javascript+module'}),'index.mjs');
  ledger.workerUploadIssued=true;save();const worker=await api('PUT','workers/scripts/'+name,form,true);ledger.resources.worker=name;ledger.resources.workerEtag=worker.etag;ledger.bundleHash=setup.hash;save();
  await api('POST','workers/scripts/'+name+'/subdomain',{enabled:true,previews_enabled:false});ledger.resources.url='https://'+name+'.mylengoctra06.workers.dev';save();
  console.log(JSON.stringify({resources:ledger.resources,http:ledger.http,setupRowsRead:ledger.rowsRead,setupRowsWritten:ledger.rowsWritten,databaseBytes:ledger.databaseBytes,bundleHash:ledger.bundleHash}));
 }else if(mode==='logs'){
  if(!ledger.resources.worker)throw Error('No dedicated Worker recorded');const from=Date.parse(ledger.createdAt),to=Date.now();
  const logs=await api('POST','workers/observability/telemetry/query',{queryId:'authority-pilot-'+Date.now(),timeframe:{from,to},view:'events',limit:200,parameters:{datasets:['cloudflare-workers'],filters:[{key:'$workers.scriptName',operation:'eq',type:'string',value:name}],filterCombination:'and'}});
  fs.writeFileSync(path.join(dir,'provider-logs.private.json'),JSON.stringify(logs));console.log(JSON.stringify({logResponseKeys:Object.keys(logs),http:ledger.http}));
 }else if(mode==='finish'){
  if(!ledger.resources.worker||ledger.resources.databaseName!==name)throw Error('Exact recorded pilot ownership required');
  const sql='SELECT requests,reserved_read,reserved_write,sets FROM fixture_budget WHERE id=1; SELECT uid,role,team_id,version,state FROM access_rows ORDER BY uid; SELECT count(*) AS auditRows FROM access_audit';
  const results=await api('POST','d1/database/'+ledger.resources.databaseId+'/query',{sql});for(const r of results){ledger.rowsRead+=r.meta.rows_read||0;ledger.rowsWritten+=r.meta.rows_written||0;}
  fs.writeFileSync(path.join(dir,'final-state.json'),JSON.stringify(results.map(r=>({results:r.results,meta:r.meta})),null,2));
  const info=await api('GET','d1/database/'+ledger.resources.databaseId);ledger.databaseBytes=info.file_size;
  await api('POST','workers/scripts/'+name+'/subdomain',{enabled:false,previews_enabled:false});ledger.workersDevDisabled=true;
  const sub=await api('GET','workers/scripts/'+name+'/subdomain');ledger.workersDevDisabledVerified=sub.enabled===false;
  save();console.log(JSON.stringify({resources:ledger.resources,controlHTTP:ledger.http,setupAndFinalRowsRead:ledger.rowsRead,setupAndFinalRowsWritten:ledger.rowsWritten,databaseBytes:ledger.databaseBytes,workersDevDisabledVerified:ledger.workersDevDisabledVerified,fixtureBudget:results[0].results[0],finalRoles:results[1].results}));
 }else if(mode==='verify-disabled'){
  const sub=await api('GET','workers/scripts/'+name+'/subdomain');ledger.workersDevDisabledVerified=sub.enabled===false;save();fs.writeFileSync(path.join(dir,'disabled-verification.json'),JSON.stringify({at:new Date().toISOString(),worker:name,status:sub}));console.log(JSON.stringify({pilotOnlySubdomainStatus:sub}));
 }else if(mode==='inspect'){
  const info=await api('GET','d1/database/'+ledger.resources.databaseId);ledger.databaseBytes=info.file_size;save();console.log(JSON.stringify({name,resources:ledger.resources,controlHTTP:ledger.http,databaseBytes:info.file_size}));
 }else throw Error('Explicit provision/logs/inspect mode required');
})().catch(e=>{save();console.error(e.message);process.exitCode=1;});
