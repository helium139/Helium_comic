// Interactive normal Firebase login; no custom tokens, credentials files or grant writes.
import {spawn} from 'node:child_process';
import {mkdir, readFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {createInterface} from 'node:readline';
import {StaffBrowserSession} from './staff-browser-session.mjs';

const wait = ms => new Promise(r => setTimeout(r, ms));
class CDP {
    #ws; #pending = new Map(); #id = 0;
    constructor(ws) {
        this.#ws = ws;
        ws.onmessage = event => {
            let msg; try { msg = JSON.parse(event.data); } catch { return; }
            if (!msg.id) return; // No console, network payload, trace or screenshot collection.
            const entry = this.#pending.get(msg.id); if (!entry) return;
            this.#pending.delete(msg.id); clearTimeout(entry.timer);
            if (msg.error) entry.reject(Error('Browser command failed'));
            else entry.resolve(msg.result);
        };
        ws.onclose = () => {
            for (const p of this.#pending.values()) {clearTimeout(p.timer); p.reject(Error('Browser closed'));}
            this.#pending.clear();
        };
    }
    async send(method, params = {}, sessionId) {
        return new Promise((resolve, reject) => {
            const id = ++this.#id;
            const timer = setTimeout(() => {this.#pending.delete(id); reject(Error('Browser command timeout'));}, 20000);
            this.#pending.set(id, {resolve, reject, timer});
            this.#ws.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
        });
    }
    close() { this.#ws.close(); }
}

async function main() {
    const plan = JSON.parse(await readFile('.local-cms-build/staff-bootstrap-plan.private.json', 'utf8'));
    const first = plan.items.filter(x => x.observedAuth.role === 'admin');
    const owner = plan.items.filter(x => x.action === 'proposed-admin-claims-repair');
    if (first.length !== 1 || owner.length !== 1) throw Error('Manifest roster ambiguous');
    const expected = {admin: first[0].uid, owner: owner[0].uid};
    // Optional exact test UID is local private metadata, never a token or password.
    try {
        const cfg = JSON.parse(await readFile('.local-cms-build/production-release/browser-test-identity.private.json', 'utf8'));
        if (typeof cfg.testUid === 'string' && ![expected.admin, expected.owner].includes(cfg.testUid)) expected.test = cfg.testUid;
    } catch (error) { if (error.code !== 'ENOENT') throw Error('Invalid test identity config'); }
    const profile = resolve('.local-cms-build/browser-smoke-profile');
    await mkdir(profile, {recursive: true});
    const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
        '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
        `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
        '--disable-breakpad', '--disable-crash-reporter', 'about:blank'
    ], {stdio: 'ignore', windowsHide: false});
    let cdp; const vault = new StaffBrowserSession(); const tabs = new Map();
    try {
        let port;
        for (let n = 0; n < 60; n++) {
            try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
            catch { await wait(250); }
        }
        if (!/^\d+$/.test(port || '')) throw Error('Browser debugging unavailable');
        const version = await (await fetch(`http://127.0.0.1:${port}/json/version`, {signal: AbortSignal.timeout(3000)})).json();
        const address = new URL(version.webSocketDebuggerUrl);
        if (!['127.0.0.1', 'localhost'].includes(address.hostname)) throw Error('Unexpected debugging host');
        const ws = new WebSocket(address);
        await new Promise((resolve, reject) => {ws.onopen = resolve; ws.onerror = () => reject(Error('Browser connection failed'));});
        cdp = new CDP(ws);
        async function open(label) {
            if (!expected[label] || tabs.has(label)) throw Error('Identity missing or tab already open');
            // Explicit off-the-record browser context: Auth cookies/IndexedDB stay ephemeral.
            const {browserContextId} = await cdp.send('Target.createBrowserContext', {disposeOnDetach: true});
            const {targetId} = await cdp.send('Target.createTarget', {
                url: 'https://heliumtg.com/login/', browserContextId, newWindow: true});
            const {sessionId} = await cdp.send('Target.attachToTarget', {targetId, flatten: true});
            await cdp.send('Runtime.enable', {}, sessionId);
            tabs.set(label, {sessionId, browserContextId});
            console.log(JSON.stringify({action: 'login-required', label, url: 'https://heliumtg.com/login/', expectedUid: expected[label]}));
        }
        await open('admin');
        console.log('Commands: open owner|test; capture admin|owner|test; refresh admin|owner|test; freeze test; probe admin|owner|test [old]; quit. No grant-changing commands.');
        const lines = createInterface({input: process.stdin, crlfDelay: Infinity});
        const interrupt = () => lines.close();
        process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
        for await (const line of lines) {
            const [command, label, option, ...extra] = line.trim().split(/\s+/);
            if (command === 'quit') break;
            try {
                if (extra.length) throw Error('Invalid command');
                if (command === 'open' && !option) {await open(label); continue;}
                if (['capture', 'refresh'].includes(command) && !option) {
                    const tab = tabs.get(label); if (!tab) throw Error('Open the identity tab first');
                    const expression = `(async()=>{if(location.origin!=='https://heliumtg.com')return {error:true};const {auth}=await import('/assets/js/firebase-session.js');await auth.authStateReady();if(!auth.currentUser)return {error:true};return {uid:auth.currentUser.uid,token:await auth.currentUser.getIdToken(${command === 'refresh'})};})()`;
                    const result = await cdp.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}, tab.sessionId);
                    if (result.exceptionDetails || result.result?.value?.error) throw Error('Normal login not ready');
                    console.log(JSON.stringify(vault.capture(label, result.result?.value, expected[label])));
                } else if (command === 'freeze' && label === 'test' && !option) console.log(JSON.stringify(vault.freezeTest()));
                else if (command === 'probe' && ['admin', 'owner', 'test'].includes(label) && (!option || option === 'old')) console.log(JSON.stringify(await vault.probe(label, option === 'old')));
                else throw Error('Invalid command');
            } catch { console.log(JSON.stringify({action: ['open','capture','refresh','freeze','probe'].includes(command) ? command : 'invalid-command', label: ['admin','owner','test'].includes(label) ? label : null, outcome: 'failed-no-automatic-retry'})); }
        }
        lines.close();
        process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    } finally {
        vault.clear();
        if (cdp) {
            for (const {browserContextId} of tabs.values()) await cdp.send('Target.disposeBrowserContext', {browserContextId}).catch(() => {});
            await cdp.send('Browser.close').catch(() => {}); cdp.close();
        }
        if (chrome.exitCode === null) chrome.kill();
    }
}
main().catch(() => {console.error('Browser smoke stopped; no credentials logged and no automatic retry.'); process.exitCode = 1;});
