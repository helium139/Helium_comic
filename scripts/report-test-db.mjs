// Deterministic Firestore test double; integration suite also uses the real emulator.
export class Stamp {constructor(value){this.value=value;}toMillis(){return this.value;}}
const clone=value=>value instanceof Stamp?new Stamp(value.value):Array.isArray(value)?value.map(clone):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])):value;
export function reportDb() {
    const data=new Map();let tail=Promise.resolve();
    const snapshot=(path)=>({ref:{path},id:path.split('/').at(-1),exists:data.has(path),data:()=>clone(data.get(path))});
    function query(prefix, group=false) {
        const conditions=[];let order='__name__',direction='asc',cursor,limit=Infinity;
        const q={where(field,op,value){conditions.push([field,value]);return q;},orderBy(field,dir='asc'){order=field;direction=dir;return q;},startAfter(value){cursor=value;return q;},limit(value){limit=value;return q;},
            async get(){let entries=[...data.entries()].filter(([path,row])=> (group?path.split('/').at(-2)===prefix:path.startsWith(prefix+'/')&&path.split('/').length===prefix.split('/').length+1)&&conditions.every(([field,value])=>row[field]===value));
                const val=([path,row])=>order==='__name__'?path.split('/').at(-1):row[order];
                entries.sort((a,b)=>(val(a)<val(b)?-1:val(a)>val(b)?1:0)*(direction==='desc'?-1:1));
                if(cursor)entries=entries.filter(entry=>direction==='desc'?val(entry)<cursor:val(entry)>cursor);
                const docs=entries.slice(0,limit).map(([path])=>snapshot(path));return {docs,size:docs.length};}};return q;
    }
    const db={data,writes:[],doc(path){return {path,get:async()=>snapshot(path)};},collection:path=>query(path),collectionGroup:name=>query(name,true),
        runTransaction(callback){const run=tail.then(async()=>{const writes=[];let writing=false;
            const get=async ref=>{if(writing)throw new Error('Read after write');return ref.path?snapshot(ref.path):ref.get();};
            const value=await callback({get,getAll:async(...refs)=>Promise.all(refs.map(get)),
                set(ref,patch,opts){writing=true;writes.push([ref.path,opts?.merge?{...clone(data.get(ref.path)),...clone(patch)}:clone(patch)]);},
                update(ref,patch){writing=true;writes.push([ref.path,{...clone(data.get(ref.path)),...clone(patch)}]);},
                create(ref,patch){if(data.has(ref.path))throw new Error('Already exists');writing=true;writes.push([ref.path,clone(patch)]);}});
            for(const [path,row]of writes){data.set(path,row);db.writes.push(path);}return value;});tail=run.catch(()=>{});return run;}};return db;
}
