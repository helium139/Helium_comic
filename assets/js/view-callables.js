import { app } from './firebase.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-functions.js';
import { VIEW_FUNCTIONS_REGION, VIEW_APP_CHECK_SITE_KEY } from './view-config.js';

let setup;
async function ensureAppCheck() {
    if (!setup) setup = (async () => {
        if (!VIEW_APP_CHECK_SITE_KEY) return;
        const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-app-check.js');
        initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(VIEW_APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
    })().catch(error => { setup = null; throw error; });
    return setup;
}
const functions = getFunctions(app, VIEW_FUNCTIONS_REGION);
export function viewCallable(name) {
    const call = httpsCallable(functions, name);
    return async data => { await ensureAppCheck(); return (await call(data)).data; };
}
