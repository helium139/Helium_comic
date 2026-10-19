import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createViewService } from '../functions/lib/views/view-service.mjs';
const require = createRequire(new URL('../functions/package.json', import.meta.url));

test('real Firestore transaction retries accept one concurrent view and update eight aggregates',
    { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
        const { initializeApp, deleteApp } = require('firebase-admin/app');
        const { getFirestore, Timestamp } = require('firebase-admin/firestore');
        const app = initializeApp({ projectId: `demo-views-${randomUUID().slice(0, 8)}` }, randomUUID());
        const db = getFirestore(app);
        let time = Date.parse('2026-10-31T23:59:50Z');
        await db.doc('viewSystem/config').set({ enabled: true, activationAt: Timestamp.fromMillis(time - 10000) });
        const catalogue = { data: { m: { teamId: 'heliumtg', chapters: [{ id: 0, pages: 1, folder: 'https://images.test/m/chap0' }] } },
            teams: [{ id: 'heliumtg' }], revision: 'real-emulator' };
        const service = createViewService({ db, timestamp: ms => Timestamp.fromMillis(ms), secret: 'test-secret'.repeat(6),
            catalogue: async () => catalogue, clock: () => time });
        const anonymousReaderId = randomUUID(), context = { network: 'test-network' };
        try {
            const sessions = await Promise.all([0, 1, 2].map(() => service.start({ mangaId: 'm', chapterId: 0,
                anonymousReaderId, requestId: randomUUID() }, context)));
            time += 10000;
            const outcomes = await Promise.all(sessions.map(session => service.record({ sessionId: session.sessionId, anonymousReaderId }, context)));
            assert.equal(outcomes.filter(outcome => outcome.accepted).length, 1);
            const events = await db.collection('chapterViewEvents').get();
            assert.equal(events.size, 1);
            const scopes = await db.collectionGroup('periods').get();
            assert.equal(scopes.size, 8);
            assert.ok(scopes.docs.every(doc => doc.data().validViews === 1));
            assert.equal((await db.doc('analyticsScopes/site/periods/2026-11').get()).data().validViews, 1);
        } finally { await db.terminate(); await deleteApp(app); }
    });
