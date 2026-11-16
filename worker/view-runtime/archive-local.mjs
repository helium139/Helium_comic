import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
const sha=text=>createHash('sha256').update(text).digest('hex');
const json=value=>JSON.stringify(value);
const sign=(key,body)=>createHmac('sha256',key).update(json(body)).digest('hex');
const checkRows=(rows,month)=>{if(!Array.isArray(rows)||!rows.length||rows.length>100)throw Error('Bounded archive segment required');for(let i=0;i<rows.length;i++)if(!/^[a-f0-9]{64}$/.test(rows[i].id)||rows[i].valid!==1||rows[i].month!==month||Buffer.byteLength(json(rows[i]))>2048||i&&rows[i-1].id>=rows[i].id)throw Error('Invalid/duplicate archive event');};
// Offline bounded-memory reference, NOT bound to a Worker HTTP/Cron request.
// store.putImmutable must reject same-key/different-content and never overwrite.
// Caller supplies a frozen, private, PK-ordered monthly source. No D1 DELETE here.
export async function createLedgerArchive({source,store,month,signingKey,assertFrozen}){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!signingKey||typeof assertFrozen!=='function')throw Error('Frozen month and private signing key required');
 await assertFrozen();let previous=null,lastId='',refs=[],count=0,segments=0,manifests=0;
 async function put(value){const text=json(value),id=sha(text);if(Buffer.byteLength(text)>262144)throw Error('Archive object exceeds256KiB');await store.putImmutable(id,text);return id;}
 async function flush(){if(!refs.length)return;previous=await put({type:'manifest-v1',month,previous,segments:refs});refs=[];manifests++;}
 for await(const rows of source){checkRows(rows,month);if(rows[0].id<=lastId)throw Error('Archive source not globally ordered');lastId=rows.at(-1).id;
  const partials=new Map();for(const row of rows){const scope=json([row.month,row.team,row.manga,row.chapter]);partials.set(scope,(partials.get(scope)||0)+1);}
  refs.push({id:await put({type:'ledger-v1',month,rows,partials:[...partials]}),count:rows.length});count+=rows.length;segments++;if(refs.length===20)await flush();
 }
 await flush();await assertFrozen();const body={type:'seal-v1',month,root:previous,count,segments,manifests,lastId};return {body,signature:sign(signingKey,body)};
}
export async function verifyLedgerArchive({seal,store,signingKey,onVerifiedSegment}){
 const signature=seal?.signature||'';if(!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(sign(signingKey,seal.body),'hex')))throw Error('Archive signature mismatch');
 async function load(id){const text=await store.get(id);if(typeof text!=='string'||Buffer.byteLength(text)>262144||sha(text)!==id)throw Error('Archive object missing/corrupt');return JSON.parse(text);}
 async function pass(emit){let next=seal.body.root,count=0,segments=0,manifests=0,upper=null;
  while(next){if(++manifests>seal.body.manifests)throw Error('Archive chain cycle');const page=await load(next);if(page.type!=='manifest-v1'||page.month!==seal.body.month||!page.segments.length||page.segments.length>20)throw Error('Invalid archive manifest');
   for(const ref of [...page.segments].reverse()){
    const segment=await load(ref.id);if(segment.type!=='ledger-v1')throw Error('Invalid segment');checkRows(segment.rows,seal.body.month);if(segment.rows.length!==ref.count||upper!==null&&segment.rows.at(-1).id>=upper||upper===null&&segment.rows.at(-1).id!==seal.body.lastId)throw Error('Archive order/count mismatch');upper=segment.rows[0].id;
    const totals=new Map();for(const row of segment.rows){const scope=json([row.month,row.team,row.manga,row.chapter]);totals.set(scope,(totals.get(scope)||0)+1);}if(json([...totals])!==json(segment.partials))throw Error('Archive report reconciliation failed');
    count+=ref.count;segments++;if(emit)await onVerifiedSegment(segment.rows,segment.partials);
   }next=page.previous;
  }
  if(count!==seal.body.count||segments!==seal.body.segments||manifests!==seal.body.manifests)throw Error('Archive completeness mismatch');return {count,segments,manifests};
 }
 const verified=await pass(false);if(onVerifiedSegment)await pass(true);return {...verified,ledgerDeleted:false};
}
