// Test-only child, still only literal loopback; IPC used solely for signal injection.
import {runLocalRequest,disk} from '../local-request.mjs';
const [url,dir,timeout='1000',signalTest='']=process.argv.slice(2);
if(signalTest==='ipc-signal')process.on('message',message=>{if(message==='interrupt')process.emit('SIGTERM');});
const io={append(file,row){if(signalTest==='fail-terminal'&&row.state==='response-saved')throw Error('ENOSPC');disk.append(file,row);},replace(file,row){if(signalTest==='fail-projection')throw Error('EIO');disk.replace(file,row);}};
try{const result=await runLocalRequest({url,dir,timeoutMs:Number(timeout),io});console.log(JSON.stringify(result));if(result.state!=='response-saved')process.exitCode=2;}catch{console.error('local-test-run-failed');process.exitCode=74;}finally{if(process.connected)process.disconnect();}
