import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export async function authorityImportGraph(){
 const root=new URL('../../',import.meta.url),seen=new Set(),external=new Set();
 async function visit(url){const name=path.relative(fileURLToPath(root),fileURLToPath(url)).replaceAll('\\','/');if(seen.has(name))return;seen.add(name);const text=await readFile(url,'utf8');
  const matches=[...text.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g),...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)];
  for(const match of matches){if(match[1].startsWith('.'))await visit(new URL(match[1],url));else external.add(match[1]);}
 }
 await visit(new URL('../../worker/view-runtime/authority-runtime.mjs',import.meta.url));
 const files=[...seen].sort(),rateModules=files.filter(f=>/view-runtime\/(schema|service)\.mjs$/.test(f));
 if(rateModules.length)throw Error('Authority unexpectedly includes view rate-history module');
 return {entry:'authority-runtime.mjs',files,external:[...external].sort(),rateHistoryReachable:false,largeJSONPaths:['team registry <=64KiB/200 teams','callable body <=2048 chars','Auth customAttributes from mocked transport'],note:'Source import graph, not final bundled CPU/size proof'};
}
