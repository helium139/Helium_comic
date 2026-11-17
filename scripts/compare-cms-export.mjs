// Source is DATA: parse only, never import/eval the exported Worker.
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../functions/package.json',import.meta.url));
const {parse}=require('espree');
const hash=s=>createHash('sha256').update(s).digest('hex');
const clean=x=>typeof x==='bigint'?{bigint:String(x)}:Array.isArray(x)?x.map(clean):
    x&&typeof x==='object'?Object.fromEntries(Object.entries(x)
        .filter(([key])=>!['start','end','loc','range'].includes(key)&&!(key==='raw'&&x.type==='Literal'))
        .map(([key,value])=>[key,clean(value)])):x;
const executable=s=>clean(parse(s,{ecmaVersion:'latest',sourceType:'module'}));
const linesOnly=s=>s.replace(/\r\n/g,'\n').split('\n').filter(line=>!line.trim().startsWith('//')).join('\n').trim();
export function compareCMSExport(live,baseline) {
    const a=executable(live),b=executable(baseline),canonicalA=JSON.stringify(a),canonicalB=JSON.stringify(b);
    const differences=[];
    function walk(left,right,path='root') {
        if(differences.length>=20||left===right)return;
        if(left===null||right===null||typeof left!==typeof right||typeof left!=='object') {
            differences.push(path);return;
        }
        for(const key of new Set([...Object.keys(left),...Object.keys(right)]))walk(left[key],right[key],path+'.'+key);
    }
    if(canonicalA!==canonicalB)walk(a,b);
    return {schemaVersion:1,parseOnly:true,live:{bytes:Buffer.byteLength(live),sha256:hash(live),
        crlfCount:(live.match(/\r\n/g)||[]).length,topLevelStatements:a.body.length,executableASTSHA256:hash(canonicalA)},
    baseline:{bytes:Buffer.byteLength(baseline),sha256:hash(baseline),topLevelStatements:b.body.length,executableASTSHA256:hash(canonicalB)},
    executableASTEqual:canonicalA===canonicalB,
    equalAfterLFAndWholeLineCommentRemoval:canonicalA===canonicalB&&linesOnly(live)===linesOnly(baseline),
    // Paths only: do not print source literals which could contain credentials.
    differingASTPaths: differences,
    normalization:'Ignore source positions and Literal.raw spelling; preserve literal values, regex patterns/flags, directives and tagged-template raw strings'};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
    if(process.argv.length!==5)throw Error('Usage: compare-cms-export <live file> <rebuilt baseline file> <report JSON>');
    const report=compareCMSExport(await readFile(process.argv[2],'utf8'),await readFile(process.argv[3],'utf8'));
    await writeFile(process.argv[4],JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({executableASTEqual:report.executableASTEqual,
        equalAfterLFAndWholeLineCommentRemoval:report.equalAfterLFAndWholeLineCommentRemoval,
        differingASTPaths:report.differingASTPaths,sourceExecuted:false}));
}
