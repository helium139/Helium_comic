import test from 'node:test';
import assert from 'node:assert/strict';
import {StaffBrowserSession} from './staff-browser-session.mjs';
import {createWorker} from '../worker/source/worker.js';
import {fail} from '../worker/source/cms-authorization.js';
const uid = 'synthetic-test';
const token = (version = 1, extra = {}) => 'header.' + Buffer.from(JSON.stringify({sub: uid,
    aud: 'helium-team-d7f80', iss: 'https://securetoken.google.com/helium-team-d7f80',
    exp: Math.floor(Date.now()/1000)+3600, role:'team_leader',teamId:'testteam',accessVersion:version,...extra})).toString('base64url') + '.fixture-not-valid-for-cloud';
test('ordinary login capture returns only allowlisted metadata; JSON never serializes tokens',()=>{
    const vault=new StaffBrowserSession(),jwt=token();
    const result=vault.capture('test',{uid,token:jwt},uid);
    assert.equal(result.accessVersion,1);assert.ok(!JSON.stringify(result).includes(jwt));
    assert.ok(!JSON.stringify(vault).includes(jwt));
});
test('frozen token survives refresh, no automatic refresh/retry during old-token probe',async()=>{
    const calls=[],vault=new StaffBrowserSession(async(url,options)=>{calls.push({url,options});return new Response('{}',{status:403});});
    vault.capture('test',{uid,token:token(1)},uid);vault.freezeTest();
    vault.capture('test',{uid,token:token(2)},uid);
    assert.throws(()=>vault.freezeTest());
    assert.equal((await vault.probe('test',true)).outcome,'access-denied');
    assert.equal(calls.length,1);assert.equal(calls[0].options.headers.Authorization,'Bearer '+token(1));
    assert.equal(calls[0].url,'https://helium-cms.mylengoctra06.workers.dev/upload');
    assert.equal(calls[0].options.body,'{}');assert.equal(calls[0].options.redirect,'error');
});
test('wrong UID/project, expired or malformed session rejected',()=>{
    for(const result of [{uid:'other',token:token()},{uid,token:token(1,{aud:'other'})},
        {uid,token:token(1,{exp:1})},{uid,token:'broken'}]) assert.throws(()=>new StaffBrowserSession().capture('test',result,uid));
});
test('admin session cannot be frozen/replayed through old-session path',async()=>{
    const vault=new StaffBrowserSession();vault.capture('admin',{uid,token:token()},uid);
    await assert.rejects(vault.probe('admin',true));
});
test('transport error cannot expose raw error or cause retry',async()=>{
    let calls=0;const secret=token(),vault=new StaffBrowserSession(async()=>{calls++;throw Error(secret);});
    vault.capture('test',{uid,token:secret},uid);
    const result=await vault.probe('test');assert.equal(calls,1);assert.equal(result.outcome,'transport-error');
    assert.ok(!JSON.stringify(result).includes(secret));vault.clear();await assert.rejects(vault.probe('test'));
});
test('HTTP error bodies containing secrets are never read or reported',async()=>{
    const secret=token(),vault=new StaffBrowserSession(async()=>new Response(secret,{status:500}));
    vault.capture('test',{uid,token:secret},uid);
    assert.deepEqual(await vault.probe('test'),{label:'test',old:false,http:500,outcome:'unexpected-status'});
});
test('legacy session is not evidence of a post-bootstrap revoke; freezing it is refused',()=>{
    const vault=new StaffBrowserSession();vault.capture('test',{uid,token:token(undefined,{accessVersion:null})},uid);
    assert.throws(()=>vault.freezeTest());
});
test('actual CMS probe rejects before storage/catalogue writes and executes current-access guard first',async()=>{
    let checks=0,denied=false;
    const worker=createWorker({verifyToken:async()=>({uid,role:'team_leader',teamId:'testteam',accessVersion:1}),
        verifyAccess:async()=>{checks++;if(denied)fail(403,'Access changed');},
        fetchImpl:async()=>{assert.fail('Probe must not fetch catalogue or write GitHub');}});
    const env={BUCKET:new Proxy({},{get(){assert.fail('Probe must not access R2');}})};
    const request=()=>new Request('https://helium-cms.mylengoctra06.workers.dev/upload',{
        method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json',Origin:'https://heliumtg.com'},body:'{}'});
    assert.equal((await worker.fetch(request(),env,{})).status,400);
    denied=true;assert.equal((await worker.fetch(request(),env,{})).status,403);
    assert.equal(checks,2);
});
