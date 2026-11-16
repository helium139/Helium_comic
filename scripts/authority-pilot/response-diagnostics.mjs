// Diagnostic data is allowlisted, never a raw response dump.
export const responseLimit=4096;
const statuses=new Set(['UNAUTHENTICATED','PERMISSION_DENIED','INVALID_ARGUMENT','NOT_FOUND','UNAVAILABLE','RESOURCE_EXHAUSTED','FAILED_PRECONDITION','ABORTED']);
export function safeURL(value,base){try{const u=new URL(value,base),known=['/getCurrentAccess','/setUserAccess','/__pilot/ready'].includes(u.pathname);return {origin:u.origin===new URL(base).origin?u.origin:'[external-host]',path:known?u.pathname:'[redacted-path]',hasQuery:!!u.search,hasCredentials:!!(u.username||u.password)};}catch{return {invalid:true};}}
export async function readLimited(response){
 const reader=response.body?.getReader();if(!reader)return {text:'',bytes:0,truncated:false};
 const chunks=[];let bytes=0,truncated=false;
 try{while(true){const {value,done}=await reader.read();if(done)break;const keep=Math.min(value.byteLength,responseLimit-bytes);if(keep)chunks.push(value.slice(0,keep));bytes+=keep;if(value.byteLength>keep||bytes===responseLimit){truncated=true;void reader.cancel().catch(()=>{});break;}}}finally{reader.releaseLock();}
 const data=new Uint8Array(bytes);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}return {text:new TextDecoder().decode(data),bytes,truncated};
}
export function safeBody(text){
 try{const b=JSON.parse(text),error=b?.error;return {format:'json',body:JSON.stringify({error:error?{status:statuses.has(error.status)?error.status:'[redacted]',code:Number.isInteger(error.code)&&error.code>=100&&error.code<=599?error.code:undefined,message:error.message===undefined?undefined:'[redacted]'}:undefined,otherFields:'[redacted]'})};}
 catch{if(/<!doctype\s+html|<html|<title/i.test(text))return {format:'html',body:'[HTML content redacted]',cloudflareErrorCode:/error code:\s*(1\d{3})\b/i.exec(text)?.[1]||null};return {format:'text',body:'[text content redacted]'};}
}
export function metricsValid(m,id){return m&&typeof m==='object'&&!Array.isArray(m)&&m.caseId===id&&['rowsRead','rowsWritten'].every(k=>Number.isSafeInteger(m[k])&&m[k]>=0)&&Number.isSafeInteger(m.databaseBytes)&&m.databaseBytes>0&&m.databaseBytes<=1048576&&typeof m.isolateFirst==='boolean'&&typeof m.isolateTag==='string'&&/^[a-zA-Z0-9-]{1,128}$/.test(m.isolateTag);}
export function responseMetadata(response,url){
 const contentType=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 const diagnostic={status:response.status,contentType:['application/json','text/html','text/plain'].includes(contentType)?contentType:'[other]',redirected:response.redirected===true,responseURL:safeURL(response.url||url,url),location:response.headers.has('location')?safeURL(response.headers.get('location'),url):null};
 const ray=response.headers.get('cf-ray');if(/^[a-f0-9]{16}-[A-Z]{3}$/.test(ray||''))diagnostic.cfRay=ray;
 return diagnostic;
}
export async function inspectResponse(response,{url,id,metrics=true}){
 const diagnostic=responseMetadata(response,url),contentType=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 let read;try{read=await readLimited(response);}catch{return {ok:false,kind:'response-loss',diagnostic};}
 Object.assign(diagnostic,{bodyBytes:read.bytes,bodyTruncated:read.truncated,...safeBody(read.text)});
 if(response.status>=300&&response.status<400||response.redirected)return {ok:false,kind:'redirect',diagnostic};
 if(response.url&&new URL(response.url).origin!==new URL(url).origin)return {ok:false,kind:'unexpected-host',diagnostic};
 if([401,403].includes(response.status))diagnostic.httpClass='authentication-or-authorization';else if(response.status>=400)diagnostic.httpClass='http-error';else diagnostic.httpClass='success';
 let body;try{body=response.status===204?{}:JSON.parse(read.text);}catch{return {ok:false,kind:response.status>=400?diagnostic.httpClass:'parse-error',detail:'invalid-json',diagnostic};}
 if(read.truncated||response.status!==204&&contentType!=='application/json')return {ok:false,kind:'protocol-error',diagnostic};
 let meta;if(metrics){try{const raw=response.headers.get('X-Helium-Pilot-Metrics');if(raw?.length>4096)throw Error();meta=JSON.parse(raw);}catch{return {ok:false,kind:diagnostic.httpClass==='success'?'metrics-parse-error':diagnostic.httpClass,detail:'metrics-parse-error',diagnostic};}if(!metricsValid(meta,id))return {ok:false,kind:diagnostic.httpClass==='success'?'metrics-schema-error':diagnostic.httpClass,detail:'metrics-schema-error',diagnostic};}
 if(metrics&&response.status!==204&&(!body||typeof body!=='object'||Array.isArray(body)||(response.status<400?(!body.result||typeof body.result!=='object'||Array.isArray(body.result)):(!body.error||typeof body.error!=='object'||!statuses.has(body.error.status)))))return {ok:false,kind:'body-schema-error',diagnostic};
 return {ok:true,body,meta,diagnostic};
}
