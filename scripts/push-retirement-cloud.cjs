// Narrow allowlisted retirement. Never reads secret values or FCM token fields.
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const project='helium-team-d7f80';
const targets=['registerPushToken','unregisterPushToken','notifyNewChapter','health'];
const mode=process.argv[2]||'inventory';
let phase='load';
const out=path.join(process.cwd(),'docs/push-retirement-'+mode+'.local.json');
async function main(){
 const root=execFileSync('npm.cmd',['root','-g'],{encoding:'utf8',shell:true}).trim();
 const auth=require(path.join(root,'firebase-tools/lib/auth.js'));
 phase='account';
 const account=auth.getProjectDefaultAccount(path.resolve(__dirname,'../../..'))||auth.getGlobalDefaultAccount();if(!account)throw Error('Firebase CLI login unavailable');
 phase='token';
 const tokens=account.tokens.expires_at>Date.now()+60000?account.tokens:await auth.getAccessToken(account.tokens.refresh_token,account.tokens.scopes||[]);
 async function api(url,method='GET',body){
  const response=await fetch(url,{method,headers:{Authorization:'Bearer '+tokens.access_token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const text=await response.text();let value;try{value=JSON.parse(text);}catch{value={};}
  if(!response.ok)return {error:true,status:response.status,reason:value.error?.status||'HTTP_ERROR'};
  return value;
 }
 const base='https://cloudfunctions.googleapis.com/v2/';
 phase='list-functions';
 const list=await api(base+`projects/${project}/locations/-/functions?pageSize=100`);
 if(list.error||list.nextPageToken)throw Error('Cannot verify complete Functions inventory');
 const functions=list.functions||[];
 const normalized=functions.map(f=>({name:f.name,id:f.name.split('/').at(-1),region:f.name.split('/')[3],environment:f.environment,state:f.state,trigger:f.eventTrigger?f.eventTrigger.eventType:'HTTPS',service:f.serviceConfig?.service,revision:f.serviceConfig?.revision,serviceAccount:f.serviceConfig?.serviceAccountEmail,secrets:(f.serviceConfig?.secretEnvironmentVariables||[]).map(s=>({secret:s.secret,projectId:s.projectId,version:s.version}))}));
 const record={project,checkedAt:new Date().toISOString(),mode,functions:normalized};
 if(mode==='inventory'){
  record.serviceAccounts=await api(`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts?pageSize=100`);
  record.projectIAM=await api(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:getIamPolicy`,'POST',{});
  record.secretMetadata=await api(`https://secretmanager.googleapis.com/v1/projects/${project}/secrets/CHAPTER_NOTIFY_SECRET`);
  record.secretIAM=await api(`https://secretmanager.googleapis.com/v1/projects/${project}/secrets/CHAPTER_NOTIFY_SECRET:getIamPolicy`);
  const run=await api(`https://run.googleapis.com/v2/projects/${project}/locations/us-central1/services?pageSize=100`);
  record.runSecretConsumers=run.error?run:{complete:!run.nextPageToken,services:(run.services||[]).map(s=>({name:s.name,account:s.template?.serviceAccount,secrets:(s.template?.containers||[]).flatMap(c=>(c.env||[]).filter(e=>e.valueSource?.secretKeyRef).map(e=>e.valueSource.secretKeyRef.secret)),volumeSecrets:(s.template?.volumes||[]).map(v=>v.secret?.secret).filter(Boolean)}))};
  const jobs=await api(`https://cloudscheduler.googleapis.com/v1/projects/${project}/locations/us-central1/jobs?pageSize=100`);
  record.scheduler=jobs.error?jobs:{complete:!jobs.nextPageToken,jobs:(jobs.jobs||[]).map(j=>({name:j.name,uri:j.httpTarget?.uri,schedule:j.schedule}))};
 }else if(mode==='delete'){
  if(!process.argv.includes('--apply-four'))throw Error('Explicit --apply-four required');
  record.operations=[];
  for(const id of targets){
   const found=normalized.filter(f=>f.id===id);
   if(found.length>1)throw Error('Ambiguous location for '+id);
   if(!found.length){record.operations.push({id,alreadyAbsent:true});continue;}
   const f=found[0];if(f.region!=='us-central1')throw Error('Unexpected region for '+id);
   const value=await api(base+f.name,'DELETE');record.operations.push({id,...value});
   if(value.error)break;
  }
 }else if(mode==='poll'){
  const previous=JSON.parse(fs.readFileSync(path.join(process.cwd(),'docs/push-retirement-delete.local.json'),'utf8'));
  record.operations=[];for(const op of previous.operations||[])if(op.name)record.operations.push(await api(base+op.name));
 }else if(mode==='token-plan'){
  const endpoint=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  const count=await api(endpoint+':runAggregationQuery','POST',{structuredAggregationQuery:{structuredQuery:{from:[{collectionId:'pushTokens',allDescendants:true}],limit:1001},aggregations:[{alias:'count',count:{}}]}});
  const entries=await api(endpoint+':runQuery','POST',{structuredQuery:{from:[{collectionId:'pushTokens',allDescendants:true}],select:{fields:[{fieldPath:'__name__'}]},limit:101}});
  record.count=count.error?count:{boundedAt1001:true,count:Number(count[0]?.result?.aggregateFields?.count?.integerValue||0)};
  record.cleanupManifest=Array.isArray(entries)?entries.filter(e=>e.document).slice(0,100).map(e=>({name:e.document.name,updateTime:e.document.updateTime})):[];
  record.moreThan100=Array.isArray(entries)&&entries.filter(e=>e.document).length>100;
  record.queryError=entries.error?entries:undefined;
  record.pathSafe=record.cleanupManifest.every(d=>new RegExp(`^projects/${project}/databases/\\(default\\)/documents/users/[^/]+/pushTokens/[^/]+$`).test(d.name));
  record.deleted=0;
 }else if(mode==='secret-delete'){
  if(!process.argv.includes('--apply-exclusive-secret'))throw Error('Explicit secret apply flag required');
  if(normalized.some(f=>targets.includes(f.id)))throw Error('Retired Functions must be absent first');
  if(normalized.some(f=>f.secrets.some(s=>s.secret==='CHAPTER_NOTIFY_SECRET')))throw Error('Secret still bound by remaining function');
  const prior=JSON.parse(fs.readFileSync(path.join(process.cwd(),'docs/push-retirement-inventory.local.json'),'utf8'));
  if(!prior.runSecretConsumers?.complete)throw Error('Run secret inventory incomplete');
  if(prior.runSecretConsumers.services.some(s=>!s.name.endsWith('/notifynewchapter')&&[...s.secrets,...s.volumeSecrets].some(n=>n.split('/').at(-1)==='CHAPTER_NOTIFY_SECRET')))throw Error('Secret shared by another service');
  record.result=await api(`https://secretmanager.googleapis.com/v1/projects/${project}/secrets/CHAPTER_NOTIFY_SECRET`,'DELETE');
 }else throw Error('Unknown mode');
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(record,null,2));
 console.log(JSON.stringify({mode,project,functions:normalized.map(f=>({id:f.id,region:f.region,state:f.state,trigger:f.trigger})),operations:record.operations?.map(o=>({id:o.id,name:o.name,done:o.done,error:o.error,status:o.status,alreadyAbsent:o.alreadyAbsent})),tokenCount:record.count,cleanupPlanCount:record.cleanupManifest?.length,moreThan100:record.moreThan100,pathSafe:record.pathSafe,queryError:record.queryError,secretResult:record.result,output:path.basename(out)},null,2));
}
main().catch(error=>{console.error(JSON.stringify({failed:true,phase,type:error.name,code:error.code||error.cause?.code}));process.exitCode=1;});
