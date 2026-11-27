const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const mode=process.argv[2]||'state';
async function main(){
 const credential=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'},stdio:['pipe','pipe','pipe']});
 const token=credential.split(/\r?\n/).find(s=>s.startsWith('password='))?.slice(9);if(!token)throw Error('No GitHub credential');
 async function api(route,method='GET',body){const response=await fetch('https://api.github.com/repos/helium139/Helium_comic'+route,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const text=await response.text();let value={};try{value=JSON.parse(text);}catch{}return response.ok?value:{error:true,status:response.status,message:value.message};}
 const main=await api('/branches/main');const pages=await api('/pages');const runs=await api('/actions/workflows/site-update.yml/runs?per_page=3');
 const secrets=await api('/actions/secrets?per_page=100');
 const record={checkedAt:new Date().toISOString(),mode,mainSHA:main.commit?.sha,pages:{buildType:pages.build_type,status:pages.status,url:pages.html_url,error:pages.error},runs:runs.workflow_runs?.map(r=>({id:r.id,sha:r.head_sha,status:r.status,conclusion:r.conclusion,url:r.html_url,event:r.event})),secretNames:secrets.secrets?.map(s=>s.name),secretReadError:secrets.error?secrets:undefined};
 if(mode==='jobs'&&record.runs?.[0])record.jobs=(await api('/actions/runs/'+record.runs[0].id+'/jobs?per_page=30')).jobs?.map(j=>({name:j.name,status:j.status,conclusion:j.conclusion,steps:j.steps?.filter(s=>s.status==='in_progress'||s.conclusion==='failure').map(s=>({name:s.name,status:s.status,conclusion:s.conclusion}))}));
 if(mode==='delete-push-secrets'){
  if(!process.argv.includes('--apply-push-secrets'))throw Error('Apply flag required');
  record.deletedSecrets=[];
  for(const name of ['PUSH_FUNCTION_URL','CHAPTER_NOTIFY_SECRET'])if(record.secretNames?.includes(name)){const result=await api('/actions/secrets/'+name,'DELETE');record.deletedSecrets.push({name,...result});}
 }
 fs.mkdirSync('docs',{recursive:true});fs.writeFileSync('docs/push-retirement-github-'+mode+'.local.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record,null,2));
}
main().catch(()=>{console.error('GitHub operation failed; credentials not printed');process.exitCode=1;});
