import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const enabled = !!process.env.FIRESTORE_EMULATOR_HOST;

test('actual merged rules deny view collections and preserve existing site permissions', { skip: !enabled }, async () => {
    const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
    const { doc, setDoc, getDoc, updateDoc, setLogLevel } = require('firebase/firestore');
    setLogLevel('silent');
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    const environment = await initializeTestEnvironment({ projectId: 'demo-helium-view-rules', firestore: {
        host, port: Number(port), rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8')
    } });
    try {
        await environment.withSecurityRulesDisabled(async context => {
            const db = context.firestore();
            await setDoc(doc(db, 'users/u'), { role: 'user', name: 'Reader' });
            await setDoc(doc(db, 'mangaStats/m'), { views: 99, likes: 0, follows: 0 });
            await setDoc(doc(db, 'mangaOwnership/m'), { teamId: 'heliumtg' });
            await setDoc(doc(db, 'mangaOwnership/other'), { teamId: 'other' });
            await setDoc(doc(db, 'analyticsScopes/team:other/periods/all'), { validViews: 10, teamId: 'other' });
        });
        const users = [environment.unauthenticatedContext(), environment.authenticatedContext('u', { role: 'user' }),
            environment.authenticatedContext('a', { role: 'admin' }),
            environment.authenticatedContext('l', { role: 'team_leader', teamId: 'heliumtg' })];
        for (const context of users) {
            const db = context.firestore();
            for (const path of ['chapterViewSessions/s', 'chapterViewEvents/e', 'viewDedup/d', 'viewRateLimits/r',
                'viewSystem/config', 'analyticsScopes/team:other/periods/all']) {
                await assertFails(getDoc(doc(db, path)));
                await assertFails(setDoc(doc(db, path), { validViews: 999 }));
            }
            await assertFails(updateDoc(doc(db, 'mangaStats/m'), { views: 100 }));
        }
        const user = users[1].firestore(), leader = users[3].firestore();
        await assertSucceeds(updateDoc(doc(user, 'users/u'), { name: 'Updated' }));
        await assertFails(updateDoc(doc(user, 'users/u'), { role: 'admin' }));
        await assertFails(updateDoc(doc(user, 'users/u'), { teamId: 'heliumtg' }));
        await assertSucceeds(setDoc(doc(user, 'users/u/history/m'), { mangaId: 'm', chapterId: 0 }));
        await assertFails(setDoc(doc(user, 'users/u/pushTokens/t'), { token: 'private' }));
        // Phase 4 moves comment writes to authenticated callables.
        await assertFails(setDoc(doc(user, 'comments/m/messages/c'), { uid: 'u', content: 'Use callable' }));
        await assertSucceeds(updateDoc(doc(user, 'mangaStats/m'), { likes: 1 }));
        await assertSucceeds(setDoc(doc(user, 'mangaStats/new'), { likes: 0, follows: 0 }));
        await assertFails(setDoc(doc(user, 'mangaStats/forged'), { views: 0, likes: 0, follows: 0 }));
        await assertSucceeds(getDoc(doc(leader, 'mangaOwnership/m')));
        await assertFails(getDoc(doc(leader, 'mangaOwnership/other')));
        assert.equal((await getDoc(doc(user, 'mangaStats/m'))).data().views, 99);
    } finally { await environment.cleanup(); }
});
