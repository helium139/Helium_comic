import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultTeamView,inTeamView,renderTeamView} from '../admin/team-view.mjs';
const teams=[{id:'heliumtg',name:'HeliumTG',active:true},{id:'other',name:'Other',active:true}];
const admin={role:'admin'},leader={role:'team_leader',teamId:'other'};
test('admin starts in HeliumTG; a direct edit link selects its actual team without changing ownership',()=>{
    assert.equal(defaultTeamView(admin,teams),'heliumtg');
    const manga={teamId:'other'},before=structuredClone(manga);
    assert.equal(defaultTeamView(admin,teams,manga),'other');
    assert.equal(inTeamView(admin,manga,teams,'heliumtg'),false);
    assert.equal(inTeamView(admin,manga,teams,'other'),true);
    assert.deepEqual(manga,before);
});
test('legacy HeliumTG metadata is visible by default; empty team view does not show other teams',()=>{
    assert.equal(inTeamView(admin,{team:'HeliumTG'},teams,'heliumtg'),true);
    assert.equal(inTeamView(admin,{teamId:'other'},teams,'missing'),false);
});
test('leader cannot use selector value or a foreign direct link to change own-team view',()=>{
    assert.equal(defaultTeamView(leader,teams,{teamId:'heliumtg'}),'other');
    assert.equal(inTeamView(leader,{teamId:'heliumtg'},teams,'heliumtg'),false);
    assert.equal(inTeamView(leader,{teamId:'other'},teams,'heliumtg'),true);
});
test('selector contains registered teams for admin and remains hidden and scoped for leader',()=>{
    const dom={createElement:()=>({})};
    const select={parentElement:{},children:[],replaceChildren(){this.children=[]},appendChild(x){this.children.push(x)}};
    renderTeamView(select,admin,teams,'heliumtg',dom);
    assert.equal(select.parentElement.hidden,false);assert.equal(select.children.length,2);
    assert.equal(select.value,'heliumtg');
    renderTeamView(select,leader,teams,'other',dom);
    assert.equal(select.parentElement.hidden,true);assert.deepEqual(select.children.map(x=>x.value),['other']);
});
