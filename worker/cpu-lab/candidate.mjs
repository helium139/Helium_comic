// Isolated lab only. The application implementation remains worker/source/*.
import {createLocalJWKSet} from 'jose';
import {createWorker} from '../source/worker.js';
import {verifyFirebaseToken} from '../source/firebase-auth.js';
const phases=new Set(['upload-serial','publish-serial','four-teams','twice-load']);
const isolateTag=crypto.randomUUID();
const imageMethods=['get','head','put','delete','list'];
export function createLabCandidate({log=record=>console.log(JSON.stringify(record))}={}) {
    let seen=false,keys,verificationAttempts=0;
    return {async fetch(request,env,ctx) {
        const firstInvocation=!seen;seen=true;
        if(!env.LAB_KEY||request.headers.get('X-Lab-Key')!==env.LAB_KEY)return new Response(null,{status:403});
        const phase=request.headers.get('X-Lab-Phase'),caseId=request.headers.get('X-Lab-Case');
        if(!phases.has(phase)||!/^[-a-z0-9]{1,64}$/.test(caseId||'')||request.method!=='POST'||
            !['/upload','/new-chapter'].includes(new URL(request.url).pathname))return new Response(null,{status:400});
        if(env.LAB_BUCKET_LABEL!=='helium-cms-access-cpu-lab-20261117'||!env.FIXTURE||!env.BUCKET||!env.LAB_BUILD_SHA)
            return new Response(null,{status:503});
        keys ||= createLocalJWKSet(JSON.parse(env.LAB_PUBLIC_JWKS));
        const firstVerificationAttempt=verificationAttempts===0;
        const r2=Object.fromEntries(imageMethods.map(k=>[k,0]));
        const bucket=Object.fromEntries(imageMethods.map(k=>[k,(...args)=>{r2[k]++;return env.BUCKET[k](...args);} ]));
        // Per request instance deliberately avoids sharing a fake backend between phases.
        // This models the ownership-cache MISS path. Never label it warm-catalogue CPU.
        const worker=createWorker({
            verifyToken:async token=>{
                verificationAttempts++;
                const actor=await verifyFirebaseToken(token,keys);
                if(!/^lab-leader-[0-3]$/.test(actor.uid)||actor.role!=='team_leader'||
                    actor.teamId!==`lab-team-${actor.uid.at(-1)}`||actor.accessVersion!==1)throw Error('Invalid synthetic subject');
                return actor;
            },
            fetchImpl:(url,options={})=>{
                const target=new URL(url);
                if(!['firestore.googleapis.com','api.github.com'].includes(target.hostname))throw Error('Lab egress denied');
                const headers=new Headers(options.headers);headers.delete('Authorization');
                headers.set('X-Lab-Key',env.LAB_KEY);headers.set('X-Lab-Phase',phase);headers.set('X-Lab-Case',caseId);
                headers.set('X-Lab-Target',target.hostname);
                return env.FIXTURE.fetch('https://fixture.invalid'+target.pathname+target.search,{...options,headers,redirect:'error'});
            },
            // No fixture timing/controller writes inside application execution.
            log:record=>log({kind:'cms-safe-log',caseId,route:record.route,operation:record.operation,outcome:record.outcome})
        });
        const response=await worker.fetch(request,{BUCKET:bucket,R2_PUBLIC_URL:'https://fixture.invalid/images',
            GITHUB_OWNER:'lab',GITHUB_REPO:'lab',GITHUB_BRANCH:'lab',GITHUB_TOKEN:'synthetic-not-a-credential'},ctx);
        const metadata={kind:'cms-cpu-sample',caseId,phase,isolateTag,firstInvocation,firstVerificationAttempt,
            keyCacheState:'not-directly-observed',
            ownershipCache:'miss-by-construction',fingerprint:env.LAB_BUILD_SHA,version:env.CF_VERSION_METADATA?.id||null,
            status:response.status,r2};
        log(metadata);
        const headers=new Headers(response.headers);
        headers.set('X-Lab-Fingerprint',env.LAB_BUILD_SHA);headers.set('X-Lab-Version',env.CF_VERSION_METADATA?.id||'unknown');
        headers.set('X-Lab-Case',caseId);headers.set('X-Lab-Isolate',isolateTag);
        headers.set('X-Lab-First-Invocation',String(firstInvocation));
        return new Response(response.body,{status:response.status,headers});
    }};
}
export default createLabCandidate();
