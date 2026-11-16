export function validateMigrationRouting(config){
 for(const name of ['views','reports','authority'])if(!['google','cloudflare'].includes(config[name]))throw Error('Unknown migration provider');
 // No Google exporter/analytics path may silently present stale A counters as
 // complete after D1 becomes the writer. A future split needs an explicit adapter.
 if(config.views!==config.reports)throw Error('View accounting and reports must share one ledger');
 if(Object.values(config).includes('cloudflare')&&!config.workerURL)throw Error('Reviewed Worker URL required');
 return config;
}
