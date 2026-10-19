import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { getDashboardScope } from '../admin/dashboard-data.mjs';
const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const helpers = {};
vm.createContext(helpers);
vm.runInContext((await read('assets/js/staff-access.js')).replace(/^import .*;\n/gm, '').replace(/export /g, ''), helpers);
const teams = [{id:'heliumtg',name:'HeliumTG'},{id:'other',name:'Other Team'}];
const catalogue = {own:{teamId:'heliumtg',title:'Alpha'},foreign:{teamId:'other',title:'Beta'}};
function dom() {
    const elements = new Map();
    function node(tag = 'div') {
        return {tag,children:[],events:{},attributes:{},value:'',hidden:false,disabled:false,
            set innerHTML(value) { throw new Error('Unsafe comment HTML'); },
            appendChild(child) { this.children.push(child); }, replaceChildren() { this.children=[]; },
            setAttribute(key,value) {this.attributes[key]=value;}, addEventListener(type, callback) {this.events[type]=callback;}};
    }
    const get = id => {if(!elements.has(id)) elements.set(id,node());return elements.get(id);};
    get('comments-state').value='all';get('comments-team-field').hidden=true;
    return {get,document:{getElementById:get,createElement:node}};
}
const root = {id:'root',name:'Reader',text:'<script>safe text</script>',createdAt:1,replyCount:1,moderationStatus:'visible'};
const hidden = {...root,id:'hidden',text:'DO NOT EXPOSE',moderationStatus:'hidden',replyCount:0};
const deleted = {...root,id:'deleted',text:'DELETED SECRET',deleted:true,replyCount:0};
const allNodes = node => [node,...node.children.flatMap(allNodes)];
const button = (root,label) => allNodes(root).find(node=>node.tag==='button' && node.textContent===label);
async function setup(staff, options = {}) {
    const d=dom(),calls=[],moderations=[];
    const context={scopeMangas:helpers.scopeMangas,assertCanManageManga:helpers.assertCanManageManga,getDashboardScope};
    vm.createContext(context);
    const source=(await read('admin/comments.js')).replace(/^import .*;\n/gm,'').replace(/export /g,'').split('\nconst currentStaff =')[0];
    vm.runInContext(source,context);
    const management=context.createCommentManagement({staff,teams,catalogue,dom:d.document,confirmAction:()=>true,requestedManga:options.requestedManga,
        list:async data=>{calls.push(data);if(options.list) return options.list(data);return {comments:data.rootId?[{...root,id:'reply',text:'Reply'}]:data.cursor?[]:[root,hidden,deleted],canModerate:options.canModerate!==false,nextCursor:data.rootId?null:data.cursor?null:{id:'next'}};},
        moderate:async data=>{moderations.push(data);}});
    await management.load();
    return {...d,management,calls,moderations};
}

test('admin team/manga filters, moderation controls, hidden/deleted redaction and lazy replies',async()=>{
    const d=await setup({role:'admin'});
    assert.deepEqual(d.get('comments-team').children.map(n=>n.textContent),['All Teams','HeliumTG','Other Team']);
    assert.equal(d.get('comments-list').children.length,3);
    const text=allNodes(d.get('comments-list')).map(n=>n.textContent||'').join('|');
    assert.match(text,/Comment hidden/);assert.match(text,/Comment deleted/);assert.doesNotMatch(text,/DO NOT EXPOSE|DELETED SECRET/);
    assert.ok(button(d.get('comments-list'),'Hide'));assert.ok(button(d.get('comments-list'),'Restore'));
    assert.equal(d.calls.length,1);
    await button(d.get('comments-list'),'Replies (1)').events.click();
    assert.equal(d.calls[1].rootId,'root');assert.match(allNodes(d.get('comments-list')).map(n=>n.textContent).join('|'),/Reply/);
    await button(d.get('comments-list'),'Hide').events.click();
    assert.deepEqual(JSON.parse(JSON.stringify(d.moderations[0])),{mangaId:'own',commentId:'root',action:'hide'});
    await button(d.get('comments-list'),'Restore').events.click();
    assert.equal(d.moderations[1].action,'restore');
    await button(d.get('comments-list'),'Delete').events.click();
    assert.equal(d.moderations[2].action,'delete');
    d.get('comments-team').value='other';await d.get('comments-team').events.change();
    assert.deepEqual(d.get('comments-manga').children.map(n=>n.value),['foreign']);
    assert.equal(d.calls.at(-1).mangaId,'foreign');
});
test('leader sees only own-team manga, no All Teams, rejects cross-team URL or selector tampering',async()=>{
    const staff={role:'team_leader',teamId:'heliumtg'};
    const d=await setup(staff);
    assert.equal(d.get('comments-team-field').hidden,true);assert.equal(d.get('comments-team').children.length,0);
    assert.deepEqual(d.get('comments-manga').children.map(n=>n.value),['own']);
    assert.ok(d.calls.every(call=>call.mangaId==='own'));
    d.get('comments-manga').value='foreign';
    await d.get('comments-manga').events.change();
    assert.match(d.get('comments-status').textContent,/Permission denied/);
    assert.ok(d.calls.every(call=>call.mangaId==='own'));
    await assert.rejects(setup(staff,{requestedManga:'foreign'}),/Permission denied/);
});
test('status filtering uses thread context, root pagination, and stale responses cannot leak prior manga',async()=>{
    const d=await setup({role:'admin'});
    d.get('comments-state').value='hidden';d.get('comments-state').events.change();
    const text=allNodes(d.get('comments-list')).map(n=>n.textContent||'').join('|');
    assert.match(text,/Thread context/);assert.match(text,/Comment hidden/);assert.doesNotMatch(text,/<script>|DELETED SECRET/);
    await d.get('comments-more').events.click();assert.deepEqual(JSON.parse(JSON.stringify(d.calls.at(-1).cursor)),{id:'next'});
    const denied=await setup({role:'admin'},{canModerate:false});
    assert.equal(denied.get('comments-list').children.length,0);assert.equal(denied.moderations.length,0);
    let settle;
    const race=await setup({role:'admin'},{list:async data=>data.mangaId==='own'?{comments:[root],canModerate:true,nextCursor:null}:new Promise(resolve=>{settle=resolve;})});
    race.get('comments-team').value='other';const old=race.get('comments-team').events.change();
    race.get('comments-team').value='heliumtg';await race.get('comments-team').events.change();
    settle({comments:[{...root,text:'Foreign response'}],canModerate:true,nextCursor:null});await old;
    assert.doesNotMatch(allNodes(race.get('comments-list')).map(n=>n.textContent).join('|'),/Foreign response/);
});
test('admin navigation links and callable-only access remain explicit',async()=>{
    for(const file of ['admin/index.html','admin/manga.html','admin/chapter.html','admin/manga/index.html','admin/chapter/index.html']) assert.match(await read(file),/href="\/admin\/comments\/"/);
    const source=await read('admin/comments.js');
    assert.doesNotMatch(source,/firebase-firestore|onSnapshot|innerHTML/);
    assert.match(source,/const currentStaff = await requireStaff\(\)/);
    assert.match(source,/moderate\(\{mangaId: id, commentId: comment.id, action: operation\}\)/);
});
