// OFFLINE ONLY. Builds private synthetic request/seed artifacts; never calls cloud.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {subjects,phases,phaseFixture,syntheticImage,imageNames,teams} from '../worker/cpu-lab/fixtures.mjs';
const require=createRequire(new URL('../worker/package.json',import.meta.url));
const {generateKeyPair,exportJWK,SignJWT}=await import(pathToFileURL(require.resolve('jose')));
const root=resolve('.local-cms-build/cpu-lab');await mkdir(root,{recursive:true});
try {
    const prior=JSON.parse(await readFile(join(root,'session.private.json'),'utf8'));
    if(prior.status!=='prepared'||prior.deployedAt||prior.openedAt||prior.issuedCases?.length||prior.reservedCases?.length)
        throw Error('Existing lab session has started; never regenerate/reset it');
} catch(error) {if(error.code!=='ENOENT')throw error;}
const bundles={candidate:await readFile(join(root,'candidate.bundle.mjs')),provider:await readFile(join(root,'provider.bundle.mjs'))};
const plan=JSON.parse(await readFile('docs/release-review-pr9/cpu-workload.json','utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const image=syntheticImage();await writeFile(join(root,'image.bin'),image);
const {privateKey,publicKey}=await generateKeyPair('RS256',{extractable:true});
const jwk={...await exportJWK(publicKey),kid:'cms-lab-only',use:'sig',alg:'RS256'};
const key=randomBytes(32).toString('hex'),now=Math.floor(Date.now()/1000);
const tokens=await Promise.all(subjects.map(s=>new SignJWT({sub:s.uid,role:s.role,teamId:s.teamId,accessVersion:1,
    auth_time:now,iat:now,exp:now+3600}).setProtectedHeader({alg:'RS256',kid:jwk.kid})
    .setIssuer('https://securetoken.google.com/helium-team-d7f80').setAudience('helium-team-d7f80').sign(privateKey)));
const artifacts=[],cases=[],seeds=[];
for(const phase of phases) {
    const fixture=phaseFixture(phase),raw=JSON.stringify(fixture.catalogue),folder=join(root,phase);
    await mkdir(folder,{recursive:true});
    const files={raw,base64:Buffer.from(raw).toString('base64'),current:JSON.stringify({version:'seed'}),
        teams:JSON.stringify({sha:'teams',content:Buffer.from(JSON.stringify(teams)).toString('base64')})};
    for(const [name,content]of Object.entries(files)) {
        const file=join(folder,name+'.txt');await writeFile(file,content);
        const suffix={raw:'versions/seed/raw',base64:'versions/seed/base64',current:'current',teams:'teams-response'}[name];
        seeds.push({phase,key:`fixture-control/${phase}/${suffix}`,file,bytes:Buffer.byteLength(content),sha256:sha(content)});
    }
    for(const c of fixture.cases) {
        const headers={'X-Lab-Key':key,'X-Lab-Phase':phase,'X-Lab-Case':c.id,Authorization:'Bearer '+tokens[c.subject]};
        let bytes,path;
        if(c.kind==='upload') {
            path='/upload';const form=new FormData();
            form.set('file',new Blob([image],{type:'image/jpeg'}),'1.jpg');
            form.set('folder',`${c.manga}/chap${c.chapter}`);form.set('filename','1.jpg');
            const request=new Request('https://fixture.invalid/upload',{method:'POST',body:form});
            headers['Content-Type']=request.headers.get('Content-Type');bytes=Buffer.from(await request.arrayBuffer());
        } else {
            path='/new-chapter';headers['Content-Type']='application/json';
            bytes=Buffer.from(JSON.stringify({manga:c.manga,chapterNumber:c.chapter,title:'Synthetic chapter',imageCount:30,images:imageNames}));
            for(const name of imageNames)seeds.push({phase,key:`${c.manga}/chap${c.chapter}/${name}`,
                file:join(root,'image.bin'),bytes:image.byteLength,sha256:sha(image),contentType:'image/jpeg'});
        }
        const file=join(folder,c.id+'.request.bin');await writeFile(file,bytes);
        cases.push({...c,phase,path,method:'POST',headers,file,bytes:bytes.length,sha256:sha(bytes),attemptsAllowed:1});
    }
    artifacts.push({phase,manga:Object.keys(fixture.catalogue).length,
        chapters:Object.values(fixture.catalogue).reduce((n,m)=>n+m.chapters.length,0),catalogueBytes:Buffer.byteLength(raw)});
}
if(cases.length!==30||cases.length!==plan.limitsProposed.candidateHTTPRequestAttempts)throw Error('Case count changed; approval required');
const names=plan.resourcesProposed;
const uploadMetadata=(kind)=>({main_module:kind+'.bundle.mjs',compatibility_date:'2026-10-19',
    observability:{enabled:true,head_sampling_rate:1,logs:{enabled:true,invocation_logs:true,head_sampling_rate:1}},
    bindings:[{name:'BUCKET',type:'r2_bucket',bucket_name:names.isolatedR2Bucket},
        {name:'LAB_KEY',type:'secret_text',text:key},
        {name:'LAB_BUCKET_LABEL',type:'plain_text',text:names.isolatedR2Bucket},
        {name:'LAB_BUILD_SHA',type:'plain_text',text:sha(bundles[kind])},
        {name:'CF_VERSION_METADATA',type:'version_metadata'},
        ...(kind==='candidate'?[{name:'FIXTURE',type:'service',service:names.fixtureWorker},
            {name:'LAB_PUBLIC_JWKS',type:'plain_text',text:JSON.stringify({keys:[jwk]})}]:[])]});
await writeFile(join(root,'deployment.private.json'),JSON.stringify({status:'not-authorized',plan,
    candidate:{name:names.candidateWorker,entry:'worker/cpu-lab/candidate.mjs',workersDev:false,previews:false,
        uploadMetadata:uploadMetadata('candidate')},
    provider:{name:names.fixtureWorker,entry:'worker/cpu-lab/provider.mjs',workersDev:false,previews:false,
        uploadMetadata:uploadMetadata('provider')},
    observability:{enabled:true,head_sampling_rate:1,logs:{enabled:true,invocation_logs:true,head_sampling_rate:1}},
    tokenExpiresAt:new Date((now+3600)*1000).toISOString(),productionCredentials:false},null,2));
await writeFile(join(root,'artifact-hashes.json'),JSON.stringify({runtime:'b486a0292c61bd438ac5731c78bede6a2318e6e0',
    files:Object.entries(bundles).map(([kind,bytes])=>({file:kind+'.bundle.mjs',bytes:bytes.length,sha256:sha(bytes)})),
    actualCloudDeploymentVersion:null},null,2));
await writeFile(join(root,'requests.private.json'),JSON.stringify({status:'not-issued',cases,artifacts,seedObjects:seeds},null,2));
await writeFile(join(root,'cleanup-plan.json'),JSON.stringify({status:'not-executed',names,
    beforeAnyDelete:['match approved account and exact resource IDs','disable candidate workers.dev/previews in finally',
        'verify both disabled; provider never public','confirm bucket binding is lab, never helium-comic'],
    objectLimit:1000,peakBytesLimit:536870912,deleteLimit:1500,
    phasesMustBePurgedAndVerifiedEmpty:true,
    beforeBucketDelete:['bounded list exact lab bucket','delete only keys under fixture-control/ or lab-manga- prefixes',
        'unknown key or limit exceeded: stop for review','verify empty'],
    final:['delete exact two lab Workers and empty lab bucket only if approved','GET exact IDs to verify absence',
        'retain all journal/reservations, including ambiguous outcomes','do not reset old authority pilot history']},null,2));
await writeFile(join(root,'session.private.json'),JSON.stringify({status:'prepared',deployedAt:null,openedAt:null,
    issuedCases:[],reservedCases:[],providerInvocationLimit:200,candidateAttemptLimit:30,controlCallLimit:36,
    expiresAfterOpeningMinutes:20,automaticRetries:0,oldPilotHistoryUntouched:true},null,2));
console.log(JSON.stringify({offline:true,cases:cases.length,seedObjectWrites:seeds.length,artifacts,
    tokenExpiresAt:new Date((now+3600)*1000).toISOString(),output:root,cloudResourcesCreated:0}));
