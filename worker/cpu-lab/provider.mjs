// Private service-binding fixture; no fetch to Google/GitHub or shared R2.
const phases=new Set(['upload-serial','publish-serial','four-teams','twice-load']);
const reply=(value,status=200)=>Response.json(value,{status});
function envelope(body,etag) {
    const reader=body.getReader(),encoder=new TextEncoder();let prefix=true;
    return new ReadableStream({async pull(controller){
        if(prefix){prefix=false;controller.enqueue(encoder.encode(JSON.stringify({sha:etag}).slice(0,-1)+',"content":"'));return;}
        const part=await reader.read();
        if(!part.done){controller.enqueue(part.value);return;}
        controller.enqueue(encoder.encode('"}'));controller.close();reader.releaseLock();
    },cancel:reason=>reader.cancel(reason)});
}
export function createFixtureProvider({log=record=>console.log(JSON.stringify(record))}={}) {
    return {async fetch(request,env) {
        if(!env.LAB_KEY||request.headers.get('X-Lab-Key')!==env.LAB_KEY||
            env.LAB_BUCKET_LABEL!=='helium-cms-access-cpu-lab-20261117')return new Response(null,{status:403});
        const phase=request.headers.get('X-Lab-Phase'),caseId=request.headers.get('X-Lab-Case'),target=request.headers.get('X-Lab-Target');
        if(!phases.has(phase))return new Response(null,{status:400});
        const url=new URL(request.url),root=`fixture-control/${phase}`;
        const counts={get:0,put:0};
        const get=key=>{counts.get++;return env.BUCKET.get(key);};
        const put=(...args)=>{counts.put++;return env.BUCKET.put(...args);};
        let response;
        if(target==='firestore.googleapis.com'&&request.method==='GET') {
            const uid=decodeURIComponent(url.pathname.split('/').at(-1));
            response=/^lab-leader-[0-3]$/.test(uid)?reply({fields:{state:{stringValue:'active'},role:{stringValue:'team_leader'},
                teamId:{stringValue:`lab-team-${uid.at(-1)}`},version:{integerValue:'1'}}}):reply({},403);
        } else if(target==='api.github.com'&&/^\/repos\/lab\/lab\/contents\/assets\/data\/(data|teams)\.json$/.test(url.pathname)) {
            const teams=url.pathname.endsWith('/teams.json');
            if(request.method==='GET'&&teams) {
                const object=await get(root+'/teams-response');response=object?new Response(object.body):reply({},404);
            } else if(request.method==='GET'&&!teams) {
                const pointer=await get(root+'/current');
                if(!pointer)return reply({},404);
                const {version}=await pointer.json();
                if(request.headers.get('If-None-Match')===`"${pointer.etag}"`)response=new Response(null,{status:304});
                else {
                    const raw=request.headers.get('Accept')==='application/vnd.github.raw+json';
                    const object=await get(`${root}/versions/${version}/${raw?'raw':'base64'}`);
                    response=object?new Response(raw?object.body:envelope(object.body,pointer.etag),
                        {headers:{'Content-Type':'application/json',ETag:`"${pointer.etag}"`}}):reply({},503);
                }
            } else if(request.method==='PUT'&&!teams) {
                const body=await request.json();
                if(typeof body.content!=='string'||body.content.length>6000000||typeof body.sha!=='string'||body.branch!=='lab')return reply({},400);
                const current=await get(root+'/current');
                if(!current||current.etag!==body.sha)response=reply({},409);
                else {
                    const version=crypto.randomUUID();
                    const bytes=Uint8Array.fromBase64?Uint8Array.fromBase64(body.content):Uint8Array.from(atob(body.content),c=>c.charCodeAt(0));
                    // Immutable versions are complete BEFORE CAS publishes the pointer.
                    await put(`${root}/versions/${version}/raw`,bytes);
                    await put(`${root}/versions/${version}/base64`,body.content);
                    const saved=await put(root+'/current',JSON.stringify({version}),{onlyIf:{etagMatches:body.sha}});
                    response=saved?reply({content:{sha:saved.etag}}):reply({},409);
                }
            } else response=reply({},405);
        } else response=reply({},403);
        log({kind:'cms-fixture-sample',caseId,phase,target,status:response.status,r2:counts,
            version:env.CF_VERSION_METADATA?.id||null,fingerprint:env.LAB_BUILD_SHA||null});
        return response;
    }};
}
export default createFixtureProvider();
