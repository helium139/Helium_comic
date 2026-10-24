// Preferred command name; retain the original module for existing callers.
import { main } from './cleanup-chapter-staging.mjs';
import { formatFailure } from './migrate.mjs';
main().catch(error => { console.error(`Cleanup stopped: ${formatFailure(error)}`); process.exitCode = 1; });
