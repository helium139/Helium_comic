import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { recordPopularity } from '../functions/lib/popularity/service.mjs';

const catalogue = async () => ({data: {m: {teamId:'heliumtg',chapters:[{id:0,pages:1,folder:'https://images.test/m/0'}]}},teams:[{id:'heliumtg'}],revision:'test'});
test('guest popularity increments only mangaStats.views and preserves likes/follows', async () => {
    const stats = {views:10,likes:4,follows:7}, writes=[];
    const dependencies = {catalogue,increment:n=>({increment:n}),db:{doc(path) {
        return {async set(patch, options) { writes.push({path,patch,options}); stats.views+=patch.views.increment; }};
    }}};
    await recordPopularity({mangaId:'m',chapterId:0,teamId:'forged',uid:'forged'},dependencies);
    assert.deepEqual(stats,{views:11,likes:4,follows:7});
    assert.deepEqual(writes,[{path:'mangaStats/m',patch:{views:{increment:1}},options:{merge:true}}]);
    await assert.rejects(recordPopularity({mangaId:'missing',chapterId:0},dependencies));
    await assert.rejects(recordPopularity({mangaId:'m',chapterId:999},dependencies));
    assert.equal(writes.length,1);
});
test('popularity adapter waits for first-image success, submits once per page, and isolates failures', async () => {
    const source=(await readFile(new URL('../assets/js/chapter-popularity.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/export /g,'');
    const calls=[];
    const context={viewCallable(name) { assert.equal(name,'recordChapterPopularity'); return async data=>{calls.push(data);throw new Error('offline');}; }};
    vm.createContext(context);vm.runInContext(source,context);
    context.recordChapterPopularity({mangaId:'m',chapterId:0,firstImage:{naturalWidth:0}});
    assert.equal(calls.length,0);
    const chapter={mangaId:'m',chapterId:0,firstImage:{naturalWidth:100}};
    context.recordChapterPopularity(chapter);context.recordChapterPopularity(chapter);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);
    context.recordChapterPopularity({...chapter,chapterId:1});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,2);
});
test('only successful chapter reader hook submits popularity; detail page and accounting stay separate',async()=>{
    const reader=await readFile(new URL('../assets/js/comicchap.js',import.meta.url),'utf8');
    const detail=await readFile(new URL('../assets/js/comicpage.js',import.meta.url),'utf8');
    assert.match(reader,/const chapterOpened = \(\) => \{[\s\S]*?recordChapterPopularity\(\{ mangaId, chapterId, firstImage \}\)/);
    assert.match(reader,/firstImage\?\.addEventListener\("load", chapterOpened/);
    assert.doesNotMatch(detail,/recordChapterPopularity|chapter-popularity/);
    const service=await readFile(new URL('../functions/lib/popularity/service.mjs',import.meta.url),'utf8');
    assert.doesNotMatch(service,/analyticsScopes|chapterViewEvents|chapterViewSessions|viewDedup/);
});
