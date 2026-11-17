export const phases=['upload-serial','publish-serial','four-teams','twice-load'];
export const subjects=Array.from({length:4},(_,i)=>({uid:`lab-leader-${i}`,role:'team_leader',teamId:`lab-team-${i}`,accessVersion:1}));
export const teams=subjects.map(s=>({id:s.teamId,slug:s.teamId,name:s.teamId,active:true}));
export const imageNames=Array.from({length:30},(_,i)=>`${i+1}-00000000-0000-4000-8000-000000000001.jpg`);
export function syntheticImage(bytes=838861) {
    const value=new Uint8Array(bytes);value.set([255,216,255,224]);return value;
}
export function catalogueFixture({manga=41,chapters=599,minBytes=591478}={}) {
    const data=Object.fromEntries(Array.from({length:manga},(_,i)=>[`lab-manga-${i}`,{teamId:subjects[i%4].teamId,
        team:subjects[i%4].teamId,title:`Synthetic ${i}`,author:'Fixture',status:'Ongoing',tags:[],description:'',
        chapters:[]} ]));
    for(let n=0;n<chapters;n++){const i=n%manga,id=Math.floor(n/manga);data[`lab-manga-${i}`].chapters.push({id,
        title:'Synthetic',pages:30,images:Array.from({length:30},(_,k)=>`${k+1}.jpg`),
        folder:`https://fixture.invalid/images/lab-manga-${i}/chap${id}`,createAt:'2026-11-01T00:00:00.000Z'});}
    const difference=minBytes-new TextEncoder().encode(JSON.stringify(data)).byteLength;
    if(difference>0)data['lab-manga-0'].fixturePadding='x'.repeat(difference);
    return data;
}
export function phaseFixture(phase) {
    const options=phase==='four-teams'?{manga:50,chapters:1199,minBytes:1250000}:
        phase==='twice-load'?{manga:50,chapters:1799,minBytes:1900000}:{};
    const cases=[];
    if(phase==='upload-serial'||phase==='publish-serial') {
        for(let i=0;i<3;i++)cases.push({id:`${phase}-${i}`,kind:phase==='upload-serial'?'upload':'publish',subject:0,chapter:1000+i});
    } else for(const kind of ['upload','publish'])for(let i=0;i<(phase==='four-teams'?4:8);i++)
        cases.push({id:`${phase}-${kind}-${i}`,kind,subject:i%4,chapter:1000+Math.floor(i/4)});
    return {phase,catalogue:catalogueFixture(options),cases:cases.map(c=>({...c,manga:`lab-manga-${c.subject}`}))};
}
// Seed only an isolated lab bucket. Caller must enforce its approved resource ID.
// This helper has no cloud client, account credential or production path.
export async function seedPhase(bucket,phase,{image=syntheticImage()}={}) {
    if(!phases.includes(phase))throw Error('Unknown lab phase');
    const fixture=phaseFixture(phase),raw=JSON.stringify(fixture.catalogue),root=`fixture-control/${phase}`;
    const bytes=new TextEncoder().encode(raw);let binary='';
    for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
    await bucket.put(root+'/versions/seed/raw',bytes);
    await bucket.put(root+'/versions/seed/base64',btoa(binary));
    await bucket.put(root+'/current',JSON.stringify({version:'seed'}));
    await bucket.put(root+'/teams-response',JSON.stringify({sha:'teams',content:btoa(JSON.stringify(teams))}));
    for(const c of fixture.cases.filter(c=>c.kind==='publish'))for(const name of imageNames)
        await bucket.put(`${c.manga}/chap${c.chapter}/${name}`,image,{httpMetadata:{contentType:'image/jpeg'}});
    return fixture;
}
