import {createD1Views} from './service.mjs';
import {createD1ReportJobs} from './report-jobs.mjs';
import {authorizeAnalytics,deny,validSlug} from '../../functions/lib/views/policy.mjs';
import {requireAdmin} from '../../functions/lib/reports/accounting.mjs';
import {utcMonths} from '../../functions/lib/reports/utc-months.mjs';
import {verifyFirebaseToken} from '../source/firebase-auth.js';
import {publishedCatalogue} from '../../functions/lib/views/catalogue.mjs';
import {createGoogleExporter} from '../../functions/lib/reports/google.mjs';

const origins=new Set(['https://heliumtg.com','https://www.heliumtg.com','http://localhost:8000','http://127.0.0.1:8000']);
const names=new Set(['startChapterViewSession','recordChapterView','getChapterViewAnalytics','getMonthlyViewDashboard','getMonthlyViewReports','generateMonthlyViewReport','retryMonthlyViewReport','setUserAccess']);

// A separate entry point: not wired into the deployed CMS or reader routing.
// Privileged authority is code-injected and must resolve current server authority,
// never a browser role. No default adapter silently falls back to stale claims.
export function createMigrationRuntime({verifyToken=verifyFirebaseToken,catalogue=publishedCatalogue,authority,exporterFactory,clock=Date.now}={}) {
 const services=env=>{
  const views=createD1Views({db:env.DB,secret:env.VIEW_READER_HMAC_KEY,catalogue,clock});
  const exporter=exporterFactory?exporterFactory(env):createGoogleExporter({clientId:env.GOOGLE_REPORT_CLIENT_ID,clientSecret:env.GOOGLE_REPORT_CLIENT_SECRET,refreshToken:env.GOOGLE_REPORT_REFRESH_TOKEN});
  return {views,reports:createD1ReportJobs({db:env.DB,views,exporter,folderId:env.GOOGLE_REPORT_FOLDER_ID,clock})};
 };
 async function analytics(data,actor,env,views){
  const scope=authorizeAnalytics(actor,data.scopeId),parts=data.scopeId.split(':');
  const months=utcMonths(clock()),config=await env.DB.prepare('SELECT * FROM config WHERE id=1').first();
  const total=await views.analytics({...data,period:'all'},actor),monthly=await views.analytics({...data,period:months.currentPeriod},actor);
  const children=[];let nextCursor=null;
  if(data.includeChildren&&scope.kind!=='chapter'){
   const where=[],args=[];
   if(scope.teamId){where.push('team=?');args.push(scope.teamId);}
   if(scope.kind==='manga'){where.push('manga=?');args.push(parts[2]);}
   const period=data.period||'all';
   if(period!=='all'){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))deny('invalid-argument','Invalid period');where.push('month=?');args.push(period);}
   const cursor=data.cursor||'';if(typeof cursor!=='string'||cursor.length>650)deny('invalid-argument','Invalid cursor');
   const field=scope.kind==='site'?'team':scope.kind==='team'?'manga':'chapter';
   const prefix=scope.kind==='site'?"'team:'||team":scope.kind==='team'?"'manga:'||team||':'||manga":"'chapter:'||team||':'||manga||':'||chapter";
   const sql=`SELECT team,${scope.kind==='site'?"NULL AS manga":'manga'},${scope.kind==='manga'?'chapter':"NULL AS chapter"},${prefix} AS scopeId,count(*) AS validViews FROM events ${where.length?'WHERE '+where.join(' AND '):''} GROUP BY ${field} HAVING scopeId>? ORDER BY scopeId LIMIT 26`;
   const rows=(await env.DB.prepare(sql).bind(...args,cursor).all()).results;
   children.push(...rows.slice(0,25).map(r=>({scopeId:r.scopeId,kind:scope.kind==='site'?'team':scope.kind==='team'?'manga':'chapter',teamId:r.team,mangaId:r.manga||null,chapterId:r.chapter??null,validViews:r.validViews})));
   if(rows.length>25)nextCursor=rows[24].scopeId;
  }
  return {scopeId:data.scopeId,period:data.period||'all',month:months.currentPeriod,total:total.validViews,monthly:monthly.validViews,active:!!config?.enabled&&config.activation<=clock(),activationAt:config?.activation??null,children,nextCursor};
 }
 async function freshActor(request){
  const header=request.headers.get('authorization');if(!header?.startsWith('Bearer '))deny('unauthenticated','Sign in required');
  const verified=await verifyToken(header.slice(7));
  if(!authority?.resolve)deny('failed-precondition','Current authority adapter is not configured');
  const actor=await authority.resolve(verified,header.slice(7));
  if(!actor||actor.uid!==verified.uid||actor.disabled)deny('permission-denied','Current access denied');
  return actor;
 }
 return {
  async fetch(request,env){
   if(env.CUTOVER_ENABLED!=='true')return Response.json({error:{status:'UNAVAILABLE',message:'Migration routing disabled'}},{status:503});
   const origin=request.headers.get('origin');if(origin&&!origins.has(origin))return new Response('Origin denied',{status:403});
   const headers=origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'POST'}});
   if(request.method!=='POST')return new Response('Method not allowed',{status:405});
   try{
    const gate=await env.DB.prepare('SELECT verified,evidence_hash FROM migration_gate WHERE id=1').first();
    if(gate?.verified!==1||!/^[a-f0-9]{64}$/.test(gate.evidence_hash||''))deny('failed-precondition','Restore/reconciliation checkpoint unverified');
    const name=new URL(request.url).pathname.split('/').at(-1);if(!names.has(name))return new Response('Not found',{status:404});
    // A staging-only injection is not enough: the real deployment also needs a
    // reviewed/imported migration checkpoint before this flag may be enabled.
    const body=await request.json();if(!body||Object.keys(body).some(k=>k!=='data'))deny('invalid-argument','Callable data required');
    const data=body.data||{}, {views,reports}=services(env);let result;
    if(name==='startChapterViewSession'||name==='recordChapterView'){
     const bearer=request.headers.get('authorization');const actor=bearer?await verifyToken(bearer.replace(/^Bearer /,'')):{};
     const network=request.headers.get('CF-Connecting-IP');
     if(!network)deny('failed-precondition','Trusted edge IP missing');
     result=await views[name==='startChapterViewSession'?'start':'record'](data,{...actor,network:network.toLowerCase().replace(/^::ffff:/,'')});
    }else{
     const actor=await freshActor(request);
     if(name==='getChapterViewAnalytics')result=await analytics(data,actor,env,views);
     if(name==='getMonthlyViewDashboard'){
      const scopeId=actor.role==='team_leader'?`team:${actor.teamId}`:data.scopeId;
      if(actor.role==='team_leader'&&data.scopeId&&data.scopeId!==scopeId)deny('permission-denied','Foreign dashboard');
      if(scopeId!=='site'&&!scopeId?.startsWith('team:'))deny('invalid-argument','Invalid dashboard scope');
      const current=await analytics({scopeId},actor,env,views),months=utcMonths(clock());
      const previous=await views.analytics({scopeId,period:months.previousPeriod},actor);
      result={...current,...months,serverNow:clock(),previousMonthly:previous.validViews};
     }
     if(name==='getMonthlyViewReports')result=await reports.history(data,actor);
     if(name==='generateMonthlyViewReport')result=await reports.generate(data,actor);
     if(name==='retryMonthlyViewReport')result=await reports.retry(data,actor);
     if(name==='setUserAccess'){
      requireAdmin(actor);
      if(!data.uid||!['user','admin','team_leader'].includes(data.role)||Object.keys(data).some(k=>!['uid','role','teamId'].includes(k)))deny('invalid-argument','Invalid access change');
      if(data.role==='team_leader'&&(!validSlug(data.teamId)||!(await catalogue()).teams.some(t=>t.id===data.teamId&&t.active)))deny('invalid-argument','Invalid active team');
      if(!authority.changeAccess)deny('failed-precondition','Access synchronization adapter is not configured');
      result=await authority.changeAccess(data,actor);
     }
    }
    return Response.json({result},{headers});
   }catch(error){const code=error.code||'unavailable';return Response.json({error:{status:code.replaceAll('-','_').toUpperCase(),message:'Operation failed: '+code}},{status:code==='unauthenticated'?401:code==='permission-denied'?403:code==='unavailable'?503:400,headers});}
  },
  async scheduled(controller,env,ctx){if(env.CUTOVER_ENABLED!=='true')return;const gate=await env.DB.prepare('SELECT verified,evidence_hash FROM migration_gate WHERE id=1').first();if(gate?.verified!==1||!/^[a-f0-9]{64}$/.test(gate.evidence_hash||''))return;ctx.waitUntil(services(env).reports.scheduled());}
 };
}
export default createMigrationRuntime();
