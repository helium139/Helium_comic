import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { paginateMangas, renderPagination, MANGA_PAGE_SIZE } from '../admin/pagination.mjs';
import { buildDashboardModel } from '../admin/dashboard-data.mjs';
const teams=[{id:'own',name:'Own'},{id:'other',name:'Other'}];
const catalogue=Object.fromEntries(Array.from({length:33},(_,i)=>[`m${i}`,{title:`Manga ${i}`,teamId:i<23?'own':'other',chapters:[]}]));
test('10 manga/page, last-page count, clamping and control disabled states',()=>{
    assert.equal(MANGA_PAGE_SIZE,10);
    const items=Object.keys(catalogue);
    assert.equal(paginateMangas(items).items.length,10);
    const last=paginateMangas(items,4);assert.equal(last.items.length,3);assert.equal(last.first,31);assert.equal(last.last,33);
    const nodes=[];const dom={createElement:()=>({setAttribute(k,v){this[k]=v;},addEventListener(t,fn){this[t]=fn;}})};
    const container={replaceChildren(){nodes.length=0;},appendChild(item){nodes.push(item);}};
    let chosen;
    renderPagination(container,paginateMangas(items),page=>chosen=page,dom);
    assert.equal(nodes[0].disabled,true);assert.equal(nodes.at(-1).disabled,false);
    nodes[2].click();assert.equal(chosen,2);
    renderPagination(container,last,()=>{},dom);assert.equal(nodes[0].disabled,false);assert.equal(nodes.at(-1).disabled,true);
    assert.equal(paginateMangas(items,999).page,4);
    const empty=paginateMangas([]);assert.equal(empty.first,0);assert.equal(empty.previousDisabled,true);assert.equal(empty.nextDisabled,true);
});
test('pagination follows team authorization; admin scope and leader fixed scope retain all permitted manga',()=>{
    const admin=buildDashboardModel({role:'admin'},catalogue,teams,'all');assert.equal(paginateMangas(admin.mangas).total,33);
    const leader=buildDashboardModel({role:'team_leader',teamId:'own'},catalogue,teams,'all');
    assert.equal(paginateMangas(leader.mangas).total,23);assert.equal(paginateMangas(leader.mangas,3).items.length,3);
    assert.ok(paginateMangas(leader.mangas,3).items.every(item=>item.manga.teamId==='own'));
});
test('search/team changes reset page 1; page navigation preserves search and avoids analytics refresh',async()=>{
    const manager=await readFile(new URL('../admin/manga.js',import.meta.url),'utf8');
    const dashboard=await readFile(new URL('../admin/dashboard.js',import.meta.url),'utf8');
    assert.match(manager,/searchInput.oninput=\(\)=>\{\s*mangaPage = 1/);
    assert.match(manager,/renderMangas\(searchInput.value\)/);
    assert.match(manager,/Object.entries\(scopeMangas\(currentStaff, mangas\)\)/);
    assert.match(dashboard,/scope = getDashboardScope[\s\S]*?mangaPage = 1;\s*render\(\)/);
    assert.match(dashboard,/mangaPage = page; render\(false\)/);
});
