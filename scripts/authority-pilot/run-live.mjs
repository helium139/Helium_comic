import {readFile,writeFile,appendFile,access} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {runMeasurementClient} from './control.mjs';
const dir=path.resolve(process.argv[2]),require=createRequire(new URL('../../worker/package.json',import.meta.url)),{SignJWT,importPKCS8}=await import(pathToFileURL(require.resolve('jose')));
const ledger=JSON.parse(await readFile(path.join(dir,'cloud-ledger.json'))),privateData=JSON.parse(await readFile(path.join(dir,'synthetic-secrets.private.json'))),journalPath=path.join(dir,'workload-journal.private.jsonl');
try{await access(journalPath);throw Error('Existing journal: do not replay an issued workload');}catch(e){if(e.code!=='ENOENT')throw e;}
await writeFile(journalPath,'',{flag:'wx'});
const steps=[];
function add(id,uid,name,expectStatus,data={},expectResult={},cryptoCase='warm',scenario='',method='POST'){steps.push({id,uid,name,expectStatus,data,expectResult,cryptoCase,scenario,method});}
add('first-cold-resolve','leader','getCurrentAccess',200,{}, {teamId:'a',accessVersion:1},'forced-key-cold');
add('warm-resolve-baseline','leader','getCurrentAccess',200,{}, {teamId:'a'});
add('cold-set-transfer','owner','setUserAccess',200,{uid:'leader',role:'team_leader',teamId:'b'},{version:2},'forced-key-cold');
add('old-claims-new-team','leader','getCurrentAccess',200,{}, {teamId:'b',accessVersion:2});
add('reader-forged-admin','reader','setUserAccess',403,{uid:'owner',role:'user'});
add('foreign-team-change-denied','staff-b','setUserAccess',403,{uid:'leader',role:'team_leader',teamId:'a'});
add('warm-set-failed-revoke','owner','setUserAccess',503,{uid:'leader',role:'user'},{},'warm','fail-claims');
add('pending-denied','leader','getCurrentAccess',403);
add('warm-set-retry-revoke','owner','setUserAccess',200,{uid:'leader',role:'user'},{version:3});
add('revoked-role-old-admin-token','leader','getCurrentAccess',200,{}, {role:'user',accessVersion:3});
add('cold-set-rollback','owner','setUserAccess',200,{uid:'leader',role:'team_leader',teamId:'a'},{version:4},'forced-key-cold');
add('rollback-new-version','leader','getCurrentAccess',200,{}, {teamId:'a',accessVersion:4});
add('disabled-account','leader','getCurrentAccess',403,{}, {},'warm','disabled');
add('revoked-auth-time','leader','getCurrentAccess',401,{}, {},'warm','revoked');
add('warm-set-backup-demotion','owner','setUserAccess',200,{uid:'backup',role:'user'},{version:2});
add('last-admin-protected','owner','setUserAccess',503,{uid:'owner',role:'user'});
add('oversized-history-rejected','leader','getCurrentAccess',400,{rateHistory:Array(10000).fill(1000000)});
for(let i=0;i<4;i++)add('options-'+i,'leader','getCurrentAccess',204,{}, {},'warm','','OPTIONS');
for(let i=0;i<8;i++)add('key-cold-resolve-'+i,'leader','getCurrentAccess',200,{}, {teamId:'a',accessVersion:4},'forced-key-cold');
for(let i=0;i<12;i++)add('warm-resolve-'+i,'leader','getCurrentAccess',200,{}, {teamId:'a',accessVersion:4});
const key=await importPKCS8(privateData.privatePEM,'RS256'),records=[];
const journal=async row=>{await appendFile(journalPath,JSON.stringify(row)+'\n');if(row.state==='observed')records.push(row);};
try{
 const result=await runMeasurementClient({baseURL:ledger.resources.url+'/',approvedHost:new URL(ledger.resources.url).host,steps,pilotSecret:privateData.secrets.PILOT_KEY,journal,getSyntheticJWT:async step=>{
  const now=Math.floor(Date.now()/1000);return new SignJWT({sub:step.uid,role:'admin',teamId:'stale',accessVersion:0,auth_time:now-60}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer('https://authority-fixture.invalid').setAudience('authority-pilot').setIssuedAt(now).setExpirationTime(now+3600).sign(key);
 }});await writeFile(path.join(dir,'workload-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({cases:records.length,allCorrect:records.every(r=>r.correct),budget:result.budget,maxBytes:Math.max(...records.map(r=>r.databaseBytes)),cpu:'awaiting-provider-traces'}));
}catch(e){await writeFile(path.join(dir,'workload-partial.json'),JSON.stringify({error:e.message,records},null,2));console.error(JSON.stringify({stopped:true,error:e.message,observed:records.length,noRetry:true}));process.exitCode=1;}
