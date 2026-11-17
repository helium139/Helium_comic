import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {fileURLToPath} from 'node:url';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createLabCandidate} from '../worker/cpu-lab/candidate.mjs';
import {createFixtureProvider} from '../worker/cpu-lab/provider.mjs';
import {subjects,phases,phaseFixture,seedPhase,imageNames} from '../worker/cpu-lab/fixtures.mjs';
const require=createRequire(new URL('../worker/package.json',import.meta.url));
const {generateKeyPair,exportJWK,SignJWT}=await import(pathToFileURL(require.resolve('jose')));
globalThis.fetch=()=>assert.fail('Local lab tests must never make external HTTP requests');
function bucket() {
    const objects=new Map();let sequence=0;
    return {objects,async get(key){const o=objects.get(key);return o?{...o,body:new Response(o.bytes).body,json:async()=>JSON.parse(new TextDecoder().decode(o.bytes))}:null;},
        async head(key){const o=objects.get(key);return o?{size:o.size,etag:o.etag,httpMetadata:o.httpMetadata}:null;},
        async put(key,body,options={}){const prior=objects.get(key);if(options.onlyIf?.etagDoesNotMatch==='*'&&prior)return null;
            if(options.onlyIf?.etagMatches&&prior?.etag!==options.onlyIf.etagMatches)return null;
            const bytes=new Uint8Array(await new Response(body).arrayBuffer()),value={bytes,size:bytes.length,etag:'e'+ ++sequence,httpMetadata:options.httpMetadata||{}};
            // Recheck CAS AFTER consuming a streaming body, as storage would.
            if(options.onlyIf?.etagMatches&&objects.get(key)?.etag!==options.onlyIf.etagMatches)return null;
            objects.set(key,value);return {etag:value.etag,size:value.size};},
        async delete(key){objects.delete(key);},async list(){return {objects:[...objects.keys()].map(key=>({key})),truncated:false};}};
}
test('approved matrix is exactly 30 cases, 4 subjects; datasets cover current/expanded/2x',()=>{
    const cases=phases.flatMap(p=>phaseFixture(p).cases);
    assert.equal(cases.length,30);assert.equal(new Set(cases.map(c=>c.id)).size,30);assert.equal(subjects.length,4);
    for(const [phase,count,min]of [['upload-serial',599,591478],['four-teams',1199,1250000],['twice-load',1799,1900000]]){
        const f=phaseFixture(phase);assert.equal(Object.values(f.catalogue).reduce((n,m)=>n+m.chapters.length,0),count);
        assert.ok(Buffer.byteLength(JSON.stringify(f.catalogue))>=min);
    }
});
test('provider private gate, fixed upstream allowlist and immutable CAS conflict',async()=>{
    const b=bucket(),provider=createFixtureProvider({log(){}}),env={BUCKET:b,LAB_KEY:'synthetic-key',LAB_BUCKET_LABEL:'helium-cms-access-cpu-lab-20261117'};
    const request=(path,method='GET',body,headers={})=>new Request('https://fixture.invalid'+path,{method,body,
        headers:{'X-Lab-Key':env.LAB_KEY,'X-Lab-Phase':'upload-serial','X-Lab-Target':'api.github.com',...headers}});
    assert.equal((await provider.fetch(new Request('https://fixture.invalid/'),env)).status,403);
    await seedPhase(b,'upload-serial',{image:new Uint8Array([255,216,255,224])});
    const path='/repos/lab/lab/contents/assets/data/data.json';const old=await(await provider.fetch(request(path),env)).json();
    const body=JSON.stringify({branch:'lab',sha:old.sha,content:old.content});
    const results=await Promise.all([provider.fetch(request(path,'PUT',body),env),provider.fetch(request(path,'PUT',body),env)]);
    assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
    const latest=await(await provider.fetch(request(path),env)).json();assert.notEqual(latest.sha,old.sha);
    assert.deepEqual(JSON.parse(Buffer.from(latest.content,'base64')),JSON.parse(Buffer.from(old.content,'base64')));
    assert.equal((await provider.fetch(request('/not-allowed'),env)).status,403);
});
test('candidate executes real JWT and CMS publish with fake transports; no CPU claims from local time',async()=>{
    const b=bucket(),logs=[],provider=createFixtureProvider({log(){}});
    const {privateKey,publicKey}=await generateKeyPair('RS256',{extractable:true}),jwk={...await exportJWK(publicKey),kid:'test',alg:'RS256',use:'sig'};
    const now=Math.floor(Date.now()/1000),token=await new SignJWT({sub:'lab-leader-0',role:'team_leader',teamId:'lab-team-0',accessVersion:1,iat:now,auth_time:now,exp:now+600})
        .setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer('https://securetoken.google.com/helium-team-d7f80').setAudience('helium-team-d7f80').sign(privateKey);
    await seedPhase(b,'publish-serial',{image:new Uint8Array([255,216,255,224])});
    const env={LAB_KEY:'synthetic',LAB_BUCKET_LABEL:'helium-cms-access-cpu-lab-20261117',LAB_PUBLIC_JWKS:JSON.stringify({keys:[jwk]}),
        LAB_BUILD_SHA:'local-fixture-only',CF_VERSION_METADATA:{id:'local-not-cloud'},BUCKET:b};
    env.FIXTURE={fetch:(url,options)=>provider.fetch(new Request(url,options),env)};
    const candidate=createLabCandidate({log:x=>logs.push(x)});
    const request=auth=>new Request('https://lab.invalid/new-chapter',{method:'POST',headers:{Authorization:auth,'X-Lab-Key':'synthetic',
        'X-Lab-Phase':'publish-serial','X-Lab-Case':'publish-serial-0','Content-Type':'application/json'},
        body:JSON.stringify({manga:'lab-manga-0',chapterNumber:1000,title:'Synthetic',imageCount:30,images:imageNames})});
    assert.equal((await candidate.fetch(request('Bearer invalid'),env)).status,401);
    const response=await candidate.fetch(request('Bearer '+token),env);assert.equal(response.status,200);
    const sample=logs.find(x=>x.kind==='cms-cpu-sample'&&x.status===200);
    assert.equal(sample.firstInvocation,false,'failed attempt already warmed the module');
    assert.equal(sample.fingerprint,'local-fixture-only');assert.ok(sample.r2.get>=60);
    assert.equal(sample.cpuTimeMs,undefined,'only provider invocation CPU may populate this');
    assert.equal([...b.objects.keys()].filter(k=>k.startsWith('lab-manga-0/chap1000/')&&/^\d+\.jpg$/.test(k.split('/').at(-1))).length,30);
});
for(const phase of ['four-teams','twice-load'])test(`${phase}: concurrent publish correctness on expanded catalogue (tiny image fixture, no cloud CPU claim)`,async()=>{
    const b=bucket(),provider=createFixtureProvider({log(){}}),{privateKey,publicKey}=await generateKeyPair('RS256',{extractable:true});
    const jwk={...await exportJWK(publicKey),kid:'parallel',alg:'RS256',use:'sig'},now=Math.floor(Date.now()/1000);
    const tokens=await Promise.all(subjects.map(s=>new SignJWT({sub:s.uid,role:s.role,teamId:s.teamId,accessVersion:1,iat:now,auth_time:now,exp:now+600})
        .setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer('https://securetoken.google.com/helium-team-d7f80').setAudience('helium-team-d7f80').sign(privateKey)));
    const fixture=await seedPhase(b,phase,{image:new Uint8Array([255,216,255,224])});
    const before=Object.values(fixture.catalogue).reduce((n,m)=>n+m.chapters.length,0);
    const env={LAB_KEY:'synthetic',LAB_BUCKET_LABEL:'helium-cms-access-cpu-lab-20261117',LAB_PUBLIC_JWKS:JSON.stringify({keys:[jwk]}),
        LAB_BUILD_SHA:'local-fixture-only',CF_VERSION_METADATA:{id:'local-not-cloud'},BUCKET:b};
    env.FIXTURE={fetch:(url,options)=>provider.fetch(new Request(url,options),env)};
    const candidate=createLabCandidate({log(){}}),cases=fixture.cases.filter(c=>c.kind==='publish');
    const responses=await Promise.all(cases.map(c=>candidate.fetch(new Request('https://lab.invalid/new-chapter',{method:'POST',
        headers:{Authorization:'Bearer '+tokens[c.subject],'X-Lab-Key':'synthetic','X-Lab-Phase':phase,'X-Lab-Case':c.id,'Content-Type':'application/json'},
        body:JSON.stringify({manga:c.manga,chapterNumber:c.chapter,title:'Synthetic',imageCount:30,images:imageNames})}),env)));
    assert.ok(responses.every(r=>[200,409].includes(r.status)));const successes=responses.filter(r=>r.status===200).length;assert.ok(successes>=1);
    const pointer=await(await b.get(`fixture-control/${phase}/current`)).json();
    const catalogue=await(await b.get(`fixture-control/${phase}/versions/${pointer.version}/raw`)).json();
    assert.equal(Object.values(catalogue).reduce((n,m)=>n+m.chapters.length,0),before+successes);
    for(let i=0;i<cases.length;i++)assert.equal(catalogue[cases[i].manga].chapters.some(ch=>ch.id===cases[i].chapter),responses[i].status===200);
});
test('offline artifact preparation refuses to reset issued/reserved session history',async()=>{
    const parent=resolve('.local-cms-build');await mkdir(parent,{recursive:true});
    const dir=await mkdtemp(join(parent,'prepare-refusal-'));
    assert.ok(dir.startsWith(parent+sep));
    try {
        const nested=join(dir,'.local-cms-build/cpu-lab');await mkdir(nested,{recursive:true});
        const file=join(nested,'session.private.json'),original=JSON.stringify({status:'prepared',reservedCases:['unknown-outcome'],issuedCases:[]});
        await writeFile(file,original);
        const result=spawnSync(process.execPath,[fileURLToPath(new URL('./prepare-cms-cpu-lab.mjs',import.meta.url))],{cwd:dir,encoding:'utf8'});
        assert.notEqual(result.status,0);assert.match(result.stderr,/never regenerate\/reset/);
        assert.equal(await readFile(file,'utf8'),original);
    } finally {await rm(dir,{recursive:true,force:true});}
});
