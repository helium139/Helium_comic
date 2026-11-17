import test from 'node:test';
import assert from 'node:assert/strict';
import {planStaffBootstrap} from './staff-bootstrap-dry-run.mjs';
function evidence(){return{project:'helium-team-d7f80',readOnly:true,checkedAt:'synthetic',
    auth:{status:200,truncated:false,staff:[{uid:'admin',role:'admin',teamId:null,accessVersion:null,disabled:false},
        {uid:'leader',role:'team_leader',teamId:'a',accessVersion:null,disabled:false}]},
    profiles:{status:200,truncated:false,staff:[{uid:'admin',role:'admin',teamId:null,accessVersion:null},
        {uid:'leader',role:'team_leader',teamId:'a',accessVersion:null}]},
    current:[{uid:'admin',status:404},{uid:'leader',status:404}],slots:[{teamId:'a',status:404}],teams:[{id:'a',active:true}]};}
test('legacy staff dry-run preserves admin and plans version 1 without mutations',()=>{
    const e=evidence(),before=structuredClone(e),p=planStaffBootstrap(e);
    assert.deepEqual(e,before);assert.equal(p.productionWrites,0);assert.equal(p.readyForBootstrapReview,true);
    assert.equal(p.plannedAdmins,1);assert.equal(p.order[0],'admin');assert.ok(p.items.every(i=>i.proposed.version===1));
});
test('profile-only admin is blocked, never silently promoted; truncated inventory remains blocked',()=>{
    const e=evidence();e.auth.staff[0].role='user';e.auth.truncated=true;
    const p=planStaffBootstrap(e);assert.equal(p.readyForBootstrapReview,false);assert.equal(p.plannedAdmins,0);
    assert.equal(p.items.find(i=>i.uid==='admin').proposed,null);assert.ok(p.blockers.some(x=>x.includes('inventory incomplete')));
});
test('two leaders cannot share a team or overwrite an occupied slot',()=>{
    const e=evidence();e.auth.staff.push({...e.auth.staff[1],uid:'second'});e.profiles.staff.push({...e.profiles.staff[1],uid:'second'});
    e.current.push({uid:'second',status:404});const p=planStaffBootstrap(e);
    assert.equal(p.readyForBootstrapReview,false);assert.equal(p.items.filter(i=>i.proposed?.role==='team_leader').length,0);
    e.slots[0]={teamId:'a',status:200,value:{uid:'unrelated'}};
    assert.ok(planStaffBootstrap(e).items.find(i=>i.uid==='leader').problems.some(x=>x.includes('another UID')));
});
test('disabled admin, pending state or partial version cannot be overwritten',()=>{
    for(const mutate of [e=>{e.auth.staff[0].disabled=true;},e=>{e.current[0]={uid:'admin',status:200,value:{state:'pending'}};},
        e=>{e.auth.staff[0].accessVersion=1;}]){const e=evidence();mutate(e);assert.equal(planStaffBootstrap(e).readyForBootstrapReview,false);}
});
test('already consistent grants are no-op; wrong project input rejected',()=>{
    const e=evidence();for(const a of e.auth.staff){a.accessVersion=4;e.profiles.staff.find(p=>p.uid===a.uid).accessVersion=4;
        e.current.find(c=>c.uid===a.uid).status=200;e.current.find(c=>c.uid===a.uid).value={state:'active',role:a.role,teamId:a.teamId,version:4};}
    e.slots[0]={teamId:'a',status:200,value:{uid:'leader'}};
    const p=planStaffBootstrap(e);assert.equal(p.readyForBootstrapReview,true);assert.ok(p.items.every(i=>i.action==='no-op'));
    e.project='another-project';assert.throws(()=>planStaffBootstrap(e));
});
test('explicit owner intent proposes admin repair without pretending Auth already grants admin',()=>{
    const e=evidence();e.auth.staff[0].role='user';const before=structuredClone(e);
    const plan=planStaffBootstrap(e,{assignments:[{uid:'admin',role:'admin',teamId:null,source:'user-confirmed-intent'}]});
    const row=plan.items.find(i=>i.uid==='admin');assert.equal(row.observedAuth.role,'user');
    assert.equal(row.proposed.role,'admin');assert.equal(row.proposed.version,1);
    assert.equal(row.requiresSeparateRightsChangeApproval,true);assert.equal(row.action,'proposed-admin-claims-repair');
    assert.deepEqual(e,before);assert.equal(plan.productionWrites,0);assert.equal(plan.releaseApproved,false);
});
