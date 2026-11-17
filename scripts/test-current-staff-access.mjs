import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {reportDb, Stamp} from './report-test-db.mjs';
import {createAccessService} from '../functions/lib/access/service.mjs';
import {currentActor, assertAccess} from '../functions/lib/access/policy.mjs';
import {verifyCurrentAccess} from '../worker/source/current-access.js';

const admin = {uid:'admin',token:{role:'admin',accessVersion:1}};
const leader = {uid:'leader',token:{role:'team_leader',teamId:'a',accessVersion:1}};
const deferred = () => {let resolve; const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture() {
    const db=reportDb(); let now=100000, mirrorFails=false, claimsFails=false, finalizeFails=false, delay;
    const claims=new Map([['leader',{role:'team_leader',teamId:'a',accessVersion:1,unrelated:'kept'}]]);
    db.data.set('staffAccess/admin',{state:'active',role:'admin',teamId:null,version:1});
    db.data.set('staffAccess/leader',{state:'active',role:'team_leader',teamId:'a',version:1});
    db.data.set('teamLeaderSlots/a',{uid:'leader',version:1});
    db.data.set('users/leader',{name:'Synthetic',role:'team_leader',teamId:'a',accessVersion:1});
    const doc=db.doc;
    db.doc=path=>({...doc(path),set:async(patch)=>{
        if(mirrorFails)throw Error('mock mirror outage');
        db.data.set(path,{...db.data.get(path),...patch});db.writes.push(path);
    }});
    const transaction=db.runTransaction;
    db.runTransaction=work=>transaction(async tx=>{
        const update=tx.update;
        tx.update=(ref,patch)=>{if(finalizeFails&&patch.state==='active')throw Error('commit outage');update(ref,patch);};
        return work(tx);
    });
    let writes=0;
    const auth={getUser:async uid=>({customClaims:structuredClone(claims.get(uid)||{})}),
        setCustomUserClaims:async(uid,value)=>{writes++;if(delay&&writes===1)await delay.promise;
            claims.set(uid,structuredClone(value));if(claimsFails)throw Error('response lost after Auth commit');}};
    const change=createAccessService({db,auth,timestamp:ms=>new Stamp(ms),clock:()=>now,
        catalogue:async()=>({teams:[{id:'a',active:true},{id:'b',active:true},{id:'off',active:false}]})});
    return {db,claims,change,input:(extra={})=>({uid:'leader',requestId:randomUUID(),expectedVersion:1,role:'team_leader',teamId:'b',...extra}),
        advance:ms=>{now+=ms;},mirrorFail:v=>{mirrorFails=v;},claimsFail:v=>{claimsFails=v;},finalizeFail:v=>{finalizeFails=v;},
        delay:v=>{delay=v;},writes:()=>writes};
}
test('pending fence rejects old token/tab before external synchronization; same-id retry does not race',async()=>{
    const h=fixture(),pause=deferred();h.delay(pause);const input=h.input();
    const running=h.change(input,admin);
    for(let i=0;i<100&&h.writes()===0;i++)await new Promise(r=>setImmediate(r));
    assert.equal(h.writes(),1);
    assert.equal(h.db.data.get('staffAccess/leader').state,'pending');
    await assert.rejects(currentActor(h.db,leader),e=>e.code==='permission-denied');
    const retry=await h.change(input,admin);assert.equal(retry.ok,false);assert.equal(retry.status,'pending');
    assert.equal(h.writes(),1);
    await assert.rejects(h.change(h.input(),admin),e=>e.code==='aborted');
    pause.resolve();const result=await running;assert.equal(result.status,'complete');
    assert.equal(result.accessVersion,2);assert.equal(h.claims.get('leader').unrelated,'kept');
    assert.equal(h.db.data.get('users/leader').accessVersion,2);
    await assert.rejects(currentActor(h.db,leader),e=>e.code==='permission-denied');
    assert.equal((await currentActor(h.db,{uid:'leader',token:h.claims.get('leader')})).teamId,'b');
    assert.equal(h.db.data.get('teamLeaderSlots/a').uid,null);
    assert.equal(h.db.data.get('teamLeaderSlots/b').uid,'leader');
});
for(const phase of ['mirror','claims','finalize'])test(`${phase} failure remains pending; recovery keeps version and one audit receipt`,async()=>{
    const h=fixture(),input=h.input();h[phase+'Fail'](true);
    const result=await h.change(input,admin);assert.equal(result.ok,false);assert.equal(result.status,'pending');
    await assert.rejects(currentActor(h.db,leader),e=>e.code==='permission-denied');
    assert.equal((await h.change(input,admin)).status,'pending');
    h[phase+'Fail'](false);h.advance(120001);
    assert.equal((await h.change(input,admin)).ok,true);
    assert.equal(h.db.data.get('staffAccess/leader').version,2);
    assert.equal([...h.db.data.keys()].filter(p=>p.startsWith('staffAccessAudit/')).length,1);
    const before=h.writes();assert.equal((await h.change(input,admin)).ok,true);assert.equal(h.writes(),before);
    assert.ok(h.db.writes.every(p=>!p.startsWith('chapterView')&&!p.startsWith('analyticsScopes')));
});
test('revocation changes role to user and rejects previously issued grant; later old receipt is superseded',async()=>{
    const h=fixture(),first=h.input();await h.change(first,admin);
    await h.change(h.input({expectedVersion:2,role:'user',teamId:undefined}),admin);
    await assert.rejects(currentActor(h.db,leader),e=>e.code==='permission-denied');
    await assert.rejects(currentActor(h.db,{uid:'leader',token:h.claims.get('leader')}),e=>e.code==='permission-denied');
    const receipt=await h.change(first,admin);assert.equal(receipt.ok,false);assert.equal(receipt.status,'superseded');
});
test('unbootstrapped/stale admin, self-change, invalid member and unknown/inactive team cannot write',async()=>{
    const h=fixture();
    for(const caller of [null,leader,{uid:'admin',token:{role:'admin'}},{uid:'missing',token:admin.token}])
        await assert.rejects(h.change(h.input(),caller),e=>['unauthenticated','permission-denied'].includes(e.code));
    for(const data of [h.input({uid:'admin'}),h.input({role:'member'}),h.input({teamId:'off'}),h.input({teamId:'missing'})])
        await assert.rejects(h.change(data,admin));
    assert.equal(h.writes(),0);
});
test('one leader per team: concurrent grants reserve one slot, and changed payload cannot reuse an id',async()=>{
    const h=fixture();h.db.data.set('staffAccess/second',{state:'active',role:'user',teamId:null,version:1});
    const first=h.input(),second=h.input({uid:'second'});
    const results=await Promise.allSettled([h.change(first,admin),h.change(second,admin)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='failed-precondition').length,1);
    assert.equal(h.db.data.get('teamLeaderSlots/b').uid,'leader');
    await assert.rejects(h.change({...first,role:'user',teamId:undefined},admin),e=>e.code==='already-exists');
});
test('permission policy has no legacy grant/version fallback',()=>{
    for(const state of [undefined,{state:'pending',version:1,role:'admin'},{state:'active',version:2,role:'admin'}])
        assert.throws(()=>assertAccess({uid:'admin',role:'admin',accessVersion:1},state));
});

const actor={uid:'leader',role:'team_leader',teamId:'a',accessVersion:1};
const document=(state='active',version=1,teamId='a')=>({fields:{state:{stringValue:state},version:{integerValue:String(version)},
    role:{stringValue:'team_leader'},teamId:{stringValue:teamId}}});
test('Worker uses caller ID token, fresh bounded authority reads, fixed host and no redirect/cache grant',async()=>{
    const requests=[];let current=document();
    const fetchImpl=async(url,options)=>{requests.push({url,options});return Response.json(current);};
    await verifyCurrentAccess(actor,'synthetic-id-token',fetchImpl);
    current=document('pending');await assert.rejects(verifyCurrentAccess(actor,'synthetic-id-token',fetchImpl),e=>e.status===403);
    current=document('active',2,'b');await assert.rejects(verifyCurrentAccess(actor,'synthetic-id-token',fetchImpl),e=>e.status===403);
    assert.equal(requests.length,3);assert.equal(new URL(requests[0].url).hostname,'firestore.googleapis.com');
    assert.equal(requests[0].options.headers.Authorization,'Bearer synthetic-id-token');
    assert.equal(requests[0].options.redirect,'error');
    assert.equal(requests[0].options.headers['Cache-Control'],'no-store');
});
for(const status of [401,403,404,429,500,302])test(`Worker authority HTTP ${status} never grants access or retries`,async()=>{
    let calls=0;await assert.rejects(verifyCurrentAccess(actor,'synthetic',async()=>{calls++;return new Response('',{status});}));
    assert.equal(calls,1);
});
test('Worker authority body errors, oversized data and transport failure fail closed',async()=>{
    for(const response of [()=>new Response('<html>'),()=>Response.json({fields:{}}),()=>new Response('x'.repeat(8193)),
        ()=>new Response(new ReadableStream({start(c){c.error(Error('lost body'));}}))])
        await assert.rejects(verifyCurrentAccess(actor,'synthetic',async()=>response()));
    await assert.rejects(verifyCurrentAccess(actor,'synthetic',async()=>{throw Error('offline');}),e=>e.status===503);
});
test('all staff callable adapters deny stale actors before reading accounting/moderation/report data',async()=>{
    const require=createRequire(new URL('../functions/package.json',import.meta.url));
    const {createViewEndpoints}=require('../functions/lib/views/endpoints.js');
    const {createCommentEndpoints}=require('../functions/lib/comments/endpoints.js');
    const {createReportEndpoints}=require('../functions/lib/reports/endpoints.js');
    const reads=[];const db={doc:path=>({get:async()=>{reads.push(path);return {data:()=>({state:'pending'})};}})};
    const view=createViewEndpoints(db),comments=createCommentEndpoints(db),reports=createReportEndpoints(db);
    for(const endpoint of [view.getChapterViewAnalytics,comments.moderateComment,comments.listComments,
        reports.getMonthlyViewDashboard,reports.getMonthlyViewReports,reports.generateMonthlyViewReport,reports.retryMonthlyViewReport]) {
        await assert.rejects(endpoint.run({data:{scopeId:'site'},auth:admin,rawRequest:{ip:'127.0.0.1'}}),e=>e.code==='permission-denied');
    }
    assert.ok(reads.length>=7);assert.ok(reads.every(p=>p==='staffAccess/admin'));
});

test('late external Auth completion cannot restore a superseded grant or overwrite a newer profile',async()=>{
 const h=fixture(),pause=deferred();h.delay(pause);const first=h.input();const old=h.change(first,admin);
 for(let i=0;i<100&&h.writes()===0;i++)await new Promise(r=>setImmediate(r));
 assert.equal(h.writes(),1);h.advance(120001);
 assert.equal((await h.change(first,admin)).ok,true);
 const revoke=h.input({expectedVersion:2,role:'user',teamId:undefined});assert.equal((await h.change(revoke,admin)).ok,true);
 pause.resolve();assert.equal((await old).ok,false);
 assert.equal(h.db.data.get('users/leader').accessVersion,3);
 assert.equal(h.db.data.get('staffAccess/leader').version,3);
 await assert.rejects(currentActor(h.db,{uid:'leader',token:h.claims.get('leader')}),e=>e.code==='permission-denied');
 assert.equal((await h.change(revoke,admin)).status,'inconsistent');
 assert.equal((await h.change(h.input({expectedVersion:3,role:'user',teamId:undefined}),admin)).ok,true);
});

test('revoked initiating admin cannot finish activation; another current admin can recover',async()=>{
 const h=fixture(),pause=deferred();h.delay(pause);const input=h.input(),running=h.change(input,admin);
 for(let i=0;i<100&&h.writes()===0;i++)await new Promise(r=>setImmediate(r));
 h.db.data.set('staffAccess/admin',{state:'active',role:'user',teamId:null,version:2});
 pause.resolve();assert.equal((await running).ok,false);assert.equal(h.db.data.get('staffAccess/leader').state,'pending');
 h.db.data.set('staffAccess/admin2',{state:'active',role:'admin',teamId:null,version:1});h.advance(120001);
 assert.equal((await h.change(input,{uid:'admin2',token:{role:'admin',accessVersion:1}})).ok,true);
 assert.equal(h.db.data.get('staffAccessAudit/leader_'+input.requestId).completedBy,'admin2');
});
