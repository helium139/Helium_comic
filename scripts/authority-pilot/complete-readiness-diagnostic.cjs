// One-shot approved diagnostic. No provisioning, SQL, resolve, SET, benchmark or logs API.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../../'),dir=path.resolve(process.argv[2]),name='helium-authority-fixture-20261116',lp=path.join(dir,'cloud-ledger.json'),ledger=JSON.parse(fs.readFileSync(lp)),plan=JSON.parse(fs.readFileSync(path.join(root,'docs/migration-evidence/authority-readiness-diagnostic-plan.json'))),privateData=JSON.parse(fs.readFileSync(path.join(dir,'synthetic-secrets.private.json'))),out=path.join(dir,'readiness-bb9a5da5-completion');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),parentPath=path.join(dir,plan.parent.journal),parentHash=hash(fs.readFileSync(parentPath)),bundle=fs.readFileSync(path.join(root,'.local/authority-readiness-v2/index.mjs'));
if(ledger.http!==48||!ledger.workersDevDisabledVerified||ledger.resources.worker!==name||ledger.resources.databaseId!==plan.databaseId||ledger.account!==process.env.CLOUDFLARE_ACCOUNT_ID||!process.env.CLOUDFLARE_API_TOKEN||hash(bundle)!==plan.bundle.hash||parentHash!==plan.parent.sha256)throw Error('Exact account/artifact/ledger/journal preconditions required');
const prior=JSON.parse(fs.readFileSync(path.join(dir,'readiness-bb9a5da5/result.private.json'))),priorJournal=path.join(dir,'readiness-bb9a5da5/journal.private.jsonl'),priorJournalHash=hash(fs.readFileSync(priorJournal));if(prior.workloadCalls!==0||!prior.cleanup?.verified)throw Error('Prior diagnostic must have issued zero workload and verified closure');
fs.mkdirSync(out);ledger.controlHTTPCap=53;ledger.controlBudgetAdjustments ||= [];ledger.controlBudgetAdjustments.push({at:new Date().toISOString(),from:50,to:53,counterUnchanged:ledger.http,reason:'Announced before execution:1 version read+enable+disable+verify+1 cleanup spare; no new workload allowance'});fs.writeFileSync(lp,JSON.stringify(ledger,null,2));const jp=path.join(out,'journal.private.jsonl');fs.writeFileSync(jp,'',{flag:'wx'});
const report={commit:'bb9a5da5e0bb2444eab4d264991459763bfd5622',started:new Date().toISOString(),parent:{...plan.parent},bundle:plan.bundle,priorControlAttempt:{workloadIssued:0,journalSHA256:priorJournalHash},approvedWorkload:{readiness:1,resolve:0,set:0,retries:0},controlBudget:{before:48,cap:53,normal:4,cleanupSpare:1,logsOmitted:true},baseline:{http:95,read:828,write:369},controls:[],response:null,readinessPass:false};
const save=()=>fs.writeFileSync(path.join(out,'result.private.json'),JSON.stringify(report,null,2)),saveLedger=()=>fs.writeFileSync(lp,JSON.stringify(ledger,null,2));
const journal=async r=>{fs.appendFileSync(jp,JSON.stringify({...r,at:new Date().toISOString()})+'\n');};save();
async function api(method,route,body,form=false){
 if(ledger.http>=53)throw Error('Control cap53 reached');ledger.http++;const row={method,route,issuedAt:new Date().toISOString(),readinessDiagnostic:true};ledger.requests.push(row);report.controls.push(row);saveLedger();save();
 const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+ledger.account+'/'+route,{method,headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,...(!form&&body?{'Content-Type':'application/json'}:{})},body:body?(form?body:JSON.stringify(body)):undefined,signal:AbortSignal.timeout(20000)}),b=await r.json();row.status=r.status;row.success=b.success;row.completedAt=new Date().toISOString();saveLedger();save();if(!r.ok||!b.success)throw Error('Control API '+r.status);return b.result;
}
(async()=>{
 const {pathToFileURL}=require('url'),{createRequire}=require('module'),req=createRequire(path.join(root,'worker/package.json'));
 const {SignJWT,importPKCS8}=await import(pathToFileURL(req.resolve('jose'))),{checkReadiness}=await import(pathToFileURL(path.join(root,'scripts/authority-pilot/readiness-client.mjs'))),{inspectResponse}=await import(pathToFileURL(path.join(root,'scripts/authority-pilot/response-diagnostics.mjs'))),{pilotBudget}=await import(pathToFileURL(path.join(root,'scripts/authority-pilot/control.mjs'))),{closePilot}=await import(pathToFileURL(path.join(root,'scripts/authority-pilot/close-pilot.mjs')));
 const budget=pilotBudget(report.baseline);let workloadCalls=0;
 try{
  await journal({state:'diagnostic-prepared',parent:plan.parent,cumulativeBudget:report.baseline,controlPlan:report.controlBudget});
  report.upload=prior.upload;save();
  const listed=await api('GET','workers/scripts/'+name+'/deployments');const {identifyActiveVersion}=await import(pathToFileURL(path.join(root,'scripts/authority-pilot/active-version.mjs')));report.activeVersion=identifyActiveVersion(listed,prior.upload.deploymentId);save();
  const deployment={versionId:report.activeVersion.versionId,buildId:plan.bundle.buildId,mode:'full'};
  if(ledger.http!==49)throw Error('Cleanup reserve must remain before enable');
  ledger.workersDevDisabled=false;ledger.workersDevDisabledVerified=false;saveLedger();
  await api('POST','workers/scripts/'+name+'/subdomain',{enabled:true,previews_enabled:false});
  // Bounded propagation wait, no HTTP readiness probe/retry during it.
  await new Promise(r=>setTimeout(r,10000));
  const key=await importPKCS8(privateData.privatePEM,'RS256');
  await checkReadiness({baseURL:ledger.resources.url+'/',approvedHost:new URL(ledger.resources.url).host,deployment,id:'readiness-bb9a5da5-once',pilotSecret:privateData.secrets.PILOT_KEY,journal,budget,getSyntheticJWT:async()=>{const now=Math.floor(Date.now()/1000);return new SignJWT({sub:'reader',iat:now,exp:now+3600,auth_time:now-60}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer('https://authority-fixture.invalid').setAudience('authority-pilot').sign(key);},fetchImpl:async(url,options)=>{
   if(++workloadCalls!==1||options.method!=='GET'||new URL(url).pathname!=='/__pilot/ready'||options.redirect!=='manual')throw Error('Single readiness only');
   const r=await fetch(url,options),inspected=await inspectResponse(r.clone(),{url:String(url),id:'readiness-bb9a5da5-once',metrics:false}),b=inspected.body;
   const actual=b?.deployment;report.response={diagnostic:inspected.diagnostic,parseOK:inspected.ok,failure:inspected.kind||null,protocolMatches:b?.protocol==='authority-pilot/v2',caseMatches:b?.caseId==='readiness-bb9a5da5-once',actualVersionId:/^[a-f0-9-]{36}$/.test(actual?.versionId||'')?actual.versionId:null,actualBuildId:/^[a-f0-9]{64}$/.test(actual?.buildId||'')?actual.buildId:null,mode:['full','validator'].includes(actual?.mode)?actual.mode:null,versionMatches:actual?.versionId===deployment.versionId,fingerprintMatches:actual?.buildId===deployment.buildId,guardUnexpired:b?.guardUnexpired===true,zeroSQLDeclared:b?.rowsRead===0&&b?.rowsWritten===0&&b?.d1Checked===false,isolateFirst:b?.isolateFirst===true,isolateTag:/^[a-zA-Z0-9-]{1,128}$/.test(b?.isolateTag||'')?b.isolateTag:null};save();return r;
  }});report.readinessPass=true;
 }catch(e){report.error=e.message;save();}
 finally{
  report.cleanup=await closePilot({api,name,pause:()=>new Promise(r=>setTimeout(r,1000))});ledger.workersDevDisabled=report.cleanup.verified;ledger.workersDevDisabledVerified=report.cleanup.verified;report.endpointVerifiedAt=new Date().toISOString();report.workloadCalls=workloadCalls;report.budget=budget.snapshot();report.finalControlHTTP=ledger.http;report.parentJournalUnchanged=hash(fs.readFileSync(parentPath))===parentHash;report.priorDiagnosticJournalUnchanged=hash(fs.readFileSync(priorJournal))===priorJournalHash;report.completed=new Date().toISOString();ledger.readinessDiagnostic={pass:report.readinessPass,workloadCalls,endpointDisabledVerified:report.cleanup.verified,bundleHash:plan.bundle.hash,completed:report.completed};saveLedger();save();
  console.log(JSON.stringify({readinessPass:report.readinessPass,error:report.error,response:report.response,cleanup:report.cleanup,workloadCalls,budget:report.budget,controlHTTP:ledger.http,parentJournalUnchanged:report.parentJournalUnchanged}));
  if(!report.cleanup.verified){console.error('URGENT: pilot endpoint disable NOT verified; see cleanup evidence');process.exitCode=2;}
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
