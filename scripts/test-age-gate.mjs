import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../assets/js/age-gate.js', import.meta.url), 'utf8');

function fixture({saved = null, blocked = false, loading = false} = {}) {
    const handlers = {}, classes = new Set(), writes = [];
    let appended = 0, opened = 0, closed = 0, removed = 0, destination;
    const button = id => ({addEventListener(type, callback) {handlers[id] = callback;}});
    const dialog = {setAttribute() {}, addEventListener(type, fn) {handlers[type] = fn;},
        querySelector: button, showModal() {opened++;}, close() {closed++;}, remove() {removed++;}};
    const context = {Promise, Date, localStorage: {
        getItem() {if(blocked)throw Error('blocked');return saved;},
        setItem(key,value) {if(blocked)throw Error('blocked');writes.push({key,value});}},
        location: {replace(url) {destination = url;}},
        document: {readyState: loading ? 'loading' : 'complete',createElement: () => dialog,
            addEventListener(type, fn) {handlers[type] = fn;},
            documentElement: {classList: {add: c => classes.add(c),remove: c => classes.delete(c)}},
            body: {appendChild() {appended++;}}}};
    vm.createContext(context);vm.runInContext(source,context);
    return {context, handlers, classes, writes, dialog, state:()=>({appended,opened,closed,removed,destination})};
}
test('first visit blocks reader readiness until explicit acceptance, then remembers only expiry',async()=>{
    const f=fixture();let ready=false;f.context.heliumAgeGateReady.then(()=>ready=true);
    await Promise.resolve();assert.equal(ready,false);assert.equal(f.state().opened,1);
    let prevented=false;f.handlers.cancel({preventDefault(){prevented=true}});assert.equal(prevented,true);
    f.handlers['[data-age-accept]']({stopPropagation(){}});
    await f.context.heliumAgeGateReady;
    assert.equal(f.state().closed,1);assert.equal(f.state().removed,1);
    assert.equal(f.classes.size,0);assert.equal(f.writes.length,1);
    assert.ok(Number(f.writes[0].value)>Date.now());
});
test('valid 24-hour confirmation skips dialog; expired/invalid/far-future values do not',async()=>{
    const f=fixture({saved:String(Date.now()+3600000)});await f.context.heliumAgeGateReady;
    assert.equal(f.state().appended,0);
    for(const saved of ['bad','0',String(Date.now()-1),String(Date.now()+172800000)])assert.equal(fixture({saved}).state().opened,1);
});
test('underage choice leaves site without storing acceptance or allowing reader initialization',async()=>{
    const f=fixture();let ready=false;f.context.heliumAgeGateReady.then(()=>ready=true);
    f.handlers['[data-age-decline]']({stopPropagation(){}});await Promise.resolve();
    assert.equal(f.state().destination,'about:blank');assert.equal(f.writes.length,0);assert.equal(ready,false);
});
test('blocked storage still allows explicit confirmation; head script waits for body',async()=>{
    const f=fixture({blocked:true,loading:true});assert.equal(f.state().opened,0);
    f.handlers.DOMContentLoaded();assert.equal(f.state().opened,1);
    f.handlers['[data-age-accept]']({stopPropagation(){}});await f.context.heliumAgeGateReady;
});
test('ad notice is static text and gate does not generate or count advertising clicks',()=>{
    const f=fixture();assert.match(f.dialog.innerHTML,/CLICK vào vị trí bất kỳ 3 lần/);
    assert.match(f.dialog.innerHTML,/LOAD hết quảng cáo/);
    assert.doesNotMatch(source,/window\.open|dispatchEvent|\.click\(|fetch\(/);
});
test('public source templates include gate assets before the reader module',async()=>{
    for(const page of ['index','comics','manga','chapter','team','teams','follow','history']) {
        const html=await readFile(new URL('../'+page+'.html',import.meta.url),'utf8');
        assert.match(html,/<link rel="stylesheet" href="\/assets\/css\/age-gate\.css">/);
        assert.match(html,/<script src="\/assets\/js\/age-gate\.js"><\/script>/);
        if(page==='chapter')assert.ok(html.indexOf('age-gate.js')<html.indexOf('comicchap.js'));
    }
});
