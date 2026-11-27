import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {isRetiredChapterPush, retireChapterPush} from '../assets/js/retire-chapter-push.mjs';
const read = file => readFile(new URL('../'+file, import.meta.url),'utf8');
const origin='https://heliumtg.com';
function registration(path='/firebase-messaging-sw.js',scope='/firebase-cloud-messaging-push-scope/') {
    const state={unsubscribed:0,unregistered:0};
    return {scope:origin+scope,active:{scriptURL:origin+path},state,
        pushManager:{async getSubscription(){return {async unsubscribe(){state.unsubscribed++;return true;}};}},
        async unregister(){state.unregistered++;return true;}};
}
test('exact chapter workers retire; PWA/ad/replacement workers survive',async()=>{
    const own=registration(),legacy=registration(undefined,'/firebase-cloud-messaging-push-scope'),ad=registration('/sw.js','/'),pwa=registration('/pwa.js','/app/'),replacement=registration();
    replacement.waiting={scriptURL:origin+'/cache.js'};
    const foreign=registration();foreign.active.scriptURL='https://other.invalid/firebase-messaging-sw.js';
    const removed=[],dbs=[],nodes=[];
    const result=await retireChapterPush({origin,navigator:{serviceWorker:{getRegistrations:async()=>[own,legacy,ad,pwa,replacement,foreign]}},storage:{removeItem:k=>removed.push(k)},indexedDB:{deleteDatabase:k=>dbs.push(k)},document:{querySelectorAll:()=>[{remove:()=>nodes.push(1)}]}});
    assert.equal(result.unregistered,2);assert.equal(result.unsubscribed,2);
    for(const untouched of [ad,pwa,replacement,foreign])assert.equal(untouched.state.unregistered,0);
    assert.deepEqual(removed,['heliumtg_push_registration']);assert.deepEqual(dbs,['firebase-messaging-database']);assert.equal(nodes.length,1);
});
test('rechecks registration after unsubscribe; exact URL required',async()=>{
    const r=registration();r.pushManager.getSubscription=async()=>({unsubscribe:async()=>{r.waiting={scriptURL:origin+'/pwa.js'};return true;}});
    assert.equal((await retireChapterPush({origin,navigator:{serviceWorker:{getRegistrations:async()=>[r]}}})).unregistered,0);
    assert.equal(isRetiredChapterPush(registration('/firebase-messaging-sw.js?other=1'),origin),false);
});
test('unsupported/blocked browser cleanup cannot block login',async()=>{
    assert.equal((await retireChapterPush({origin,navigator:{}})).failed,0);
    assert.equal((await retireChapterPush({origin,navigator:{serviceWorker:{getRegistrations:async()=>{throw Error('blocked');}}}})).failed,1);
});
test('retirement worker unregisters only itself, no messaging/cache handlers',async()=>{
    const source=await read('firebase-messaging-sw.js'),listeners={},r=registration();let pending;
    const self={location:{origin,href:origin+'/firebase-messaging-sw.js'},registration:r,skipWaiting:async()=>{},addEventListener:(type,callback)=>listeners[type]=callback};
    vm.runInNewContext(source,{self,URL});listeners.activate({waitUntil:p=>pending=p});await pending;
    assert.equal(r.state.unregistered,1);assert.equal(listeners.push,undefined);assert.equal(listeners.notificationclick,undefined);
    const wrong=registration('/sw.js','/');self.registration=wrong;listeners.activate({waitUntil:p=>pending=p});await pending;assert.equal(wrong.state.unregistered,0);
    assert.doesNotMatch(source,/importScripts|showNotification|caches\.|clients\.claim/);
});
