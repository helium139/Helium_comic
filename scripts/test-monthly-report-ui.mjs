import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createMonthRollover} from '../assets/js/month-rollover.mjs';
function events(){return {events:{},visibilityState:'visible',addEventListener(type,fn){this.events[type]=fn;},removeEventListener(type){delete this.events[type];},emit(type,event={}){return this.events[type]?.(event);}};}
test('open dashboard rolls over using server time despite browser timezone/skew, resumes after hidden/bfcache',async()=>{
    const doc=events(),win=events(),timers=new Map();let monotonic=0,next=0,refreshes=0;
    const watch=createMonthRollover({doc,win,now:()=>monotonic,schedule:(fn,delay)=>{timers.set(++next,{fn,delay});return next;},cancel:id=>timers.delete(id),refresh:async()=>{refreshes++;watch.sync({serverNow:2000,nextBoundary:100000});}});
    watch.sync({serverNow:1000,nextBoundary:2000});assert.equal(timers.size,1);
    monotonic=1001;const timer=[...timers.values()][0];timers.clear();await timer.fn();assert.equal(refreshes,1);
    doc.visibilityState='hidden';await doc.emit('visibilitychange');assert.equal(timers.size,0);
    monotonic=2000;doc.visibilityState='visible';await doc.emit('visibilitychange');await new Promise(resolve=>setImmediate(resolve));assert.equal(refreshes,2);
    await win.emit('pageshow',{persisted:true});await new Promise(resolve=>setImmediate(resolve));assert.equal(refreshes,3);
    watch.dispose();assert.equal(timers.size,0);assert.equal(Object.keys(doc.events).length,0);
});
function dom(){const map=new Map();function node(tag='div'){return{tag,children:[],events:{},value:'all',hidden:false,
    appendChild(item){this.children.push(item);},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},
    setAttribute(){},addEventListener(type,fn){this.events[type]=fn;},remove(){}};}
    const get=id=>{if(!map.has(id))map.set(id,node());return map.get(id);};return{get,document:{getElementById:get,createElement:node}};}
const strip=source=>source.replace(/^import .*;\n/gm,'').replace(/export /g,'');
test('dashboard current/previous/all cards stay scope-safe and zero missing new month after rollover',async()=>{
    const source=strip(await readFile(new URL('../admin/view-analytics.js',import.meta.url),'utf8'));
    const d=dom(),calls=[];let next={active:true,activationAt:1,currentPeriod:'2026-10',previousPeriod:'2026-09',monthly:8,previousMonthly:3,total:11,serverNow:1,nextBoundary:2},refresh;
    const context={window:{},document:d.document,getViewAnalytics:async()=>({children:[]}),getMonthlyViewDashboard:async data=>{calls.push(data);return next;},
        createMonthRollover:options=>{refresh=options.refresh;return{sync(){},dispose(){}};}};
    vm.createContext(context);vm.runInContext(source,context);
    const analytics=context.createDashboardAnalytics({staff:{role:'admin'},teams:[],catalogue:{}});
    await analytics.update('all');assert.equal(calls[0].scopeId,'site');assert.equal(d.get('monthly-valid-views').textContent,'8');assert.equal(d.get('previous-month-valid-views').textContent,'3');
    next={...next,currentPeriod:'2026-11',previousPeriod:'2026-10',monthly:0,previousMonthly:8};await refresh();
    assert.equal(d.get('monthly-valid-views').textContent,'0');assert.equal(d.get('previous-month-valid-views').textContent,'8');assert.equal(d.get('total-valid-views').textContent,'11');
    await analytics.update('heliumtg');assert.equal(calls.at(-1).scopeId,'team:heliumtg');
    const leader=context.createDashboardAnalytics({staff:{role:'team_leader',teamId:'heliumtg'},teams:[],catalogue:{}});await leader.update('other');assert.equal(calls.at(-1).scopeId,'team:heliumtg');
});
test('report history is admin-only, shows safe links and retries only incomplete reports',async()=>{
    const source=strip(await readFile(new URL('../admin/reports.js',import.meta.url),'utf8')).split('\nconst staff =')[0];
    const d=dom(),retries=[],context={getMonthlyViewReports:async()=>({reports:[]}),retryMonthlyViewReport:async()=>({})};vm.createContext(context);vm.runInContext(source,context);
    assert.throws(()=>context.createReportsPage({staff:{role:'team_leader'},dom:d.document}),/admin-only/);
    const page=context.createReportsPage({staff:{role:'admin'},dom:d.document,confirmAction:()=>true,history:async()=>({reports:[
        {month:'2026-10',totalValidViews:7,teamCount:2,status:'generated',generatedAt:1,spreadsheetUrl:'https://docs.google.com/spreadsheets/d/sheet123/edit'},
        {month:'2026-09',totalValidViews:4,teamCount:1,status:'failed',error:'Owner attention required'}],nextCursor:null}),retry:async data=>retries.push(data)});
    await page.load();assert.equal(d.get('report-rows').children[0].children.at(-1).children[0].textContent,'Open Sheet');
    await d.get('report-rows').children[1].children.at(-1).children[0].events.click();assert.equal(retries[0].month,'2026-09');
});

test('sleeping visible browser rechecks UTC month when wall time advances but performance clock pauses',async()=>{
    let wall=0,callback,refreshes=0;const doc=events(),win=events();
    const watcher=createMonthRollover({doc,win,now:()=>0,wallNow:()=>wall,schedule:fn=>{callback=fn;return 1;},cancel(){},refresh:async()=>{refreshes++;}});
    watcher.sync({serverNow:1000,nextBoundary:2000});wall=5000;await callback();assert.equal(refreshes,1);watcher.dispose();
});
