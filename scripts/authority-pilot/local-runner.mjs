// Local runner only. Intentionally no Cloudflare adapter or credentials.
import {runLocalRequest,PersistenceError,readLocalState} from './local-request.mjs';
const [url,dir,timeout='1000']=process.argv.slice(2);
try{const result=await runLocalRequest({url,dir,timeoutMs:Number(timeout)});console.log(JSON.stringify(result));if(result.state!=='response-saved')process.exitCode=2;}catch(error){console.error(error instanceof PersistenceError?'Persistence failure; inspect durable journal; do not replay':'Local request stopped; existing run is never replayed');if(dir){try{console.error(JSON.stringify(readLocalState(dir)));}catch{}}process.exitCode=error instanceof PersistenceError?74:2;}
