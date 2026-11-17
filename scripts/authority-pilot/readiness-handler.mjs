// Isolated fixture only. No DB, Google transport, budget update or audit writes.
export const protocol='authority-pilot/v2';
export function deploymentIdentity(env,buildId){
 const versionId=env.CF_VERSION_METADATA?.id,mode=env.PILOT_REGISTRY_MODE;
 if(!/^[a-f0-9]{64}$/.test(buildId||'')||!/^[a-f0-9-]{36}$/.test(versionId||'')||!['full','validator'].includes(mode))return null;
 return {buildId,versionId,mode};
}
export async function readinessResponse(request,env,{buildId,caseId,isolateTag,isolateFirst,verifyToken,clock=Date.now}){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 if(request.method!=='GET')return Response.json({error:{status:'INVALID_ARGUMENT'}},{status:405,headers});
 const match=/^Bearer ([^\s]+)$/.exec(request.headers.get('authorization')||'');
 try{if(!match||match[1].length>16384)throw Error();await verifyToken(match[1]);}catch{return Response.json({error:{status:'UNAUTHENTICATED'}},{status:401,headers});}
 const deployment=deploymentIdentity(env,buildId);
 if(!deployment)return Response.json({error:{status:'UNAVAILABLE'}},{status:503,headers});
 const until=Number(env.PILOT_READY_UNTIL),guardUnexpired=Number.isSafeInteger(until)&&until>clock();
 return Response.json({protocol,caseId,deployment,isolateTag,isolateFirst,scope:'transport-only',guardUnexpired,rowsRead:0,rowsWritten:0,d1Checked:false},{headers});
}
