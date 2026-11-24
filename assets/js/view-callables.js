import { app } from './firebase.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-functions.js';
import { VIEW_FUNCTIONS_REGION, VIEW_APP_CHECK_SITE_KEY } from './view-config.js';
import { MIGRATION_ROUTING } from './migration-routing.js';
import { migrationCallable } from './migration-callable-transport.mjs';
import { validateMigrationRouting } from './migration-routing-policy.mjs';

let setup, appCheckInstance;
async function ensureAppCheck() {
    if (!setup) setup = (async () => {
        if (!VIEW_APP_CHECK_SITE_KEY) return;
        const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-app-check.js');
        appCheckInstance = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(VIEW_APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
    })().catch(error => { setup = null; throw error; });
    return setup;
}
const functions = getFunctions(app, VIEW_FUNCTIONS_REGION);
export function viewCallable(name, options) {
    validateMigrationRouting(MIGRATION_ROUTING);
    const group=['startChapterViewSession','recordChapterView','getChapterViewAnalytics'].includes(name)?'views':name==='setUserAccess'||name==='getCurrentAccess'?'authority':'reports';
    if(MIGRATION_ROUTING[group]==='cloudflare') {
        const call=migrationCallable({baseURL:MIGRATION_ROUTING.workerURL,name,timeout:options?.timeout,
            getIdToken:async()=>{const {getAuth}=await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js');const auth=getAuth(app);await auth.authStateReady();const user=auth.currentUser;return {token:await user?.getIdToken()||null,isCurrent:()=>auth.currentUser===user};},
            getAppCheckToken:async()=>{if(!VIEW_APP_CHECK_SITE_KEY)return null;const {getToken}=await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-app-check.js');return (await getToken(appCheckInstance)).token;}});
        return async data=>{await ensureAppCheck();return call(data);};
    }
    const call = httpsCallable(functions, name, options);
    return async data => { await ensureAppCheck(); return (await call(data)).data; };
}
