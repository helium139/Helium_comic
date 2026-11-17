import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export function sizeViews({S,R,A=R,pStart=0,pAccepted=pStart,rateDeletes,dedupDeletes,sharedWrites=null,sharedReads=null,reserve=5000,reportWrites=1}){
 if(![S,R,A].every(n=>Number.isSafeInteger(n)&&n>=0)||A>R||![pStart,pAccepted].every(p=>p>=0&&p<=1))throw Error('Explicit counts and auth mix required');
 const foreground=(3+pStart)*S+R+(5+2*pAccepted)*A;
 const sessionsDeleted=S,maxRateDeletes=(2+pStart)*S+(2+pAccepted)*A,maxDedupDeletes=(1+pAccepted)*A;
 const lifecycleMin=foreground+sessionsDeleted,lifecycleMax=lifecycleMin+maxRateDeletes+maxDedupDeletes;
 const specified=rateDeletes!==undefined&&dedupDeletes!==undefined;
 if(specified&&![rateDeletes,dedupDeletes].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('Measured expired-key counts required');
 const addition=(sharedWrites??0)+reserve+reportWrites,lower=Math.ceil(lifecycleMin+addition),upper=Math.ceil(lifecycleMax+addition);
 return {foregroundWrites:foreground,sessionDeletes:sessionsDeleted,rateDeleteUpper:maxRateDeletes,dedupDeleteUpper:maxDedupDeletes,writesWithAssumedReserve:[lower,upper],writesIfExpiredKeysKnown:specified?Math.ceil(lifecycleMin+rateDeletes+dedupDeletes+addition):null,remainingDailyWrites:[100000-upper,100000-lower],sharedWritesVerified:sharedWrites!==null,remainingReadQuota:sharedReads===null?null:5000000-sharedReads,headroom25Percent:upper<=75000?'sizing-only-pass':'not-proven',cloudCPUVerified:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const saved=JSON.parse(await readFile(new URL('../docs/migration-evidence/saved-baseline.json',import.meta.url))),scenarios=[];
 for(const scale of [1,2])for(const p of [0,1])scenarios.push({scale,authenticatedShareAssumption:p,allRecordAcceptedForSizing:true,...sizeViews({S:saved.traffic.peakStart*scale,R:saved.traffic.peakRecord*scale,pStart:p})});
 const result={status:'sensitivity-not-accepted-view-normalization',source:'reused post-A saved windows; no collector or production telemetry',outcomeMixKnown:false,accountDailyD1UsageKnown:false,workersHTTPWithReportedExistingSensitivity:[18773+2990,37546+2990],scenarios};
 const output=JSON.stringify(result,null,2)+'\n';if(process.argv[2])await writeFile(process.argv[2],output);else process.stdout.write(output);
}
