import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash,generateKeyPairSync,randomBytes} from 'node:crypto';
import {installAuthorityPackage} from '../../worker/view-runtime/authority-runtime.mjs';
import {fileURLToPath} from 'node:url';
const output=path.resolve(process.argv[2]);await mkdir(output,{recursive:true});
const candidate=process.argv[3]==='--candidate';
if(process.argv[3]&&!candidate)throw Error('Unknown build variant');
try{await access(path.join(output,'cloud-ledger.json'));throw Error('Existing cloud run: do not regenerate its fixture keys/setup');}catch(e){if(e.code!=='ENOENT')throw e;}
const require=createRequire(new URL('../../worker/package.json',import.meta.url)),esbuild=require('esbuild');
const buildOptions={entryPoints:[fileURLToPath(new URL(candidate?'./candidate-worker.mjs':'./fixture-worker.mjs',import.meta.url))],nodePaths:[fileURLToPath(new URL('../../worker/node_modules',import.meta.url))],tsconfigRaw:{},bundle:true,format:'esm',platform:'browser',target:'es2022',external:['node:*']};
// Hash the complete pre-identity bundle, including dependencies, then embed it.
const preliminary=candidate?await esbuild.build({...buildOptions,write:false,define:{__PILOT_BUILD_ID__:JSON.stringify('unbound')}}):null;
const buildId=preliminary?createHash('sha256').update(preliminary.outputFiles[0].contents).digest('hex'):null;
await esbuild.build({...buildOptions,...(candidate?{define:{__PILOT_BUILD_ID__:JSON.stringify(buildId)}}:{}),outfile:path.join(output,'index.mjs')});
const bundle=await readFile(path.join(output,'index.mjs')),hash=createHash('sha256').update(bundle).digest('hex');
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),privatePEM=privateKey.export({format:'pem',type:'pkcs8'}),jwk={...publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256',use:'sig'};
const expires=Date.now()+7200000,secrets={PILOT_KEY:randomBytes(32).toString('hex'),FIXTURE_PUBLIC_JWK:JSON.stringify(jwk),FIXTURE_SERVICE_ACCOUNT:JSON.stringify({type:'service_account',client_email:'fixture@demo-authority-fixture.iam.gserviceaccount.com',private_key:privatePEM})};
await writeFile(path.join(output,'synthetic-secrets.private.json'),JSON.stringify({secrets,privatePEM}));
const queries=[];await installAuthorityPackage({prepare:sql=>({run:async()=>queries.push({sql,params:[]})})});
queries.push({sql:'CREATE TABLE fixture_google(uid TEXT PRIMARY KEY,body TEXT NOT NULL) WITHOUT ROWID',params:[]});
queries.push({sql:'CREATE TABLE fixture_budget(id INTEGER PRIMARY KEY,requests INTEGER,reserved_read INTEGER,reserved_write INTEGER,sets INTEGER,expires INTEGER)',params:[]});
queries.push({sql:'INSERT INTO fixture_budget VALUES(1,50,64,128,0,?)',params:[expires]});
queries.push({sql:'UPDATE migration_gate SET verified=1,evidence_hash=?,free_features=?,free_expires=? WHERE id=1',params:[hash,'["authority"]',expires]});
for(const [uid,role,team]of [['owner','admin',null],['backup','admin',null],['leader','team_leader','a'],['reader','user',null],['staff-b','team_leader','b']]){
 queries.push({sql:'INSERT INTO access_rows(uid,role,team_id) VALUES(?,?,?)',params:[uid,role,team]});
 const mirror={role:{stringValue:role},teamId:team?{stringValue:team}:{nullValue:null},version:{integerValue:'1'},state:{stringValue:'active'},leaseUntilMs:{integerValue:String(Date.now()+300000)}};
 queries.push({sql:'INSERT INTO fixture_google VALUES(?,?)',params:[uid,JSON.stringify({claims:{role,teamId:team,accessVersion:1,unrelated:'界'.repeat(250)},disabled:false,mirror,mirrorVersion:1,profile:{role:{stringValue:role}}})]});
}
await writeFile(path.join(output,'setup.private.json'),JSON.stringify({queries,hash,expires,buildId,variant:candidate?"candidate":"fixture"}));
console.log(JSON.stringify({bundleBytes:bundle.length,sha256:hash,esbuildVersion:esbuild.version,setupQueries:queries.length,syntheticIdentities:5,networkRequests:0}));
