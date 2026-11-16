import {writeFile} from 'node:fs/promises';
import {authorityImportGraph} from './import-graph.mjs';
const graph=await authorityImportGraph();
await writeFile(new URL('../../docs/migration-evidence/authority-pilot-import-graph.json',import.meta.url),JSON.stringify(graph,null,2)+'\n');
console.log(JSON.stringify({rateHistoryReachable:graph.rateHistoryReachable,sourceModules:graph.files.length,networkRequests:0,resourcesCreated:0}));
