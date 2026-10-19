import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { commentText, publicComment } from '../functions/lib/comments/service.mjs';

test('input validation and legacy compatibility redact hidden/deleted content', () => {
    assert.equal(commentText('  Hello  '), 'Hello');
    for (const value of ['', '  ', 'x'.repeat(4001), null, {}]) assert.throws(() => commentText(value));
    const old = { uid: 'u', content: 'Legacy text', name: 'Old reader', createdAt: { toMillis: () => 12 } };
    const entry = publicComment('old', old);
    assert.equal(entry.text, 'Legacy text'); assert.equal(entry.parentId, null); assert.equal(entry.rootId, null);
    assert.equal(entry.deleted, false); assert.equal(entry.moderationStatus, 'visible');
    assert.equal(publicComment('d', {...old, deleted: true}).text, null);
    assert.equal(publicComment('h', {...old, moderationStatus: 'hidden'}).text, null);
    assert.equal(publicComment('a', {...old, avatar: 'javascript:alert(1)'}).avatar, null);
});

function node() {
    return { children: [], events: {}, value: '', hidden: false, dataset: {},
        set innerHTML(value) { throw new Error('Unsafe HTML rendering'); },
        append(...items) { this.children.push(...items); }, appendChild(item) { this.children.push(item); },
        after() {}, replaceChildren() { this.children = []; }, setAttribute() {},
        addEventListener(type, callback) { this.events[type] = callback; }, querySelector() { return null; } };
}
test('UI uses safe text, deleted placeholders, bounded root/reply requests and no realtime listeners', async () => {
    const source = (await readFile(new URL('../assets/js/comment.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
    assert.doesNotMatch(source, /onSnapshot|innerHTML|firebase-firestore/);
    const elements = new Map(), requests = [], events = {};
    const get = id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
    const context = { document: { getElementById: get, createElement: node }, auth: { currentUser: null },
        onAuthStateChanged() {}, getRouteParams: () => new Map([['id', 'm']]),
        window: { addEventListener(type, callback) { events[type] = callback; } },
        listComments: async data => { requests.push(data); return { comments: [], canModerate: false, nextCursor: null }; }
    };
    vm.createContext(context); vm.runInContext(source, context);
    const container = node();
    context.render({id: 'd', uid: 'u', name: '<img onerror=alert(1)>', text: 'SECRET', deleted: true, createdAt: null, replyCount: 0}, container, 0);
    assert.equal(container.children[0].children[1].textContent, 'Comment deleted');
    const visible = node();
    context.render({id: 'v', uid: 'u', name: 'Reader', text: '<script>alert(1)</script>', createdAt: null, replyCount: 1}, visible, 0);
    assert.equal(visible.children[0].children[1].textContent, '<script>alert(1)</script>');
    assert.equal(requests.length, 0);
    await visible.children[0].children[3].events.click();
    assert.equal(requests[0].rootId, 'v');
    await context.loadRoots(true);
    assert.equal(requests[1].mangaId, 'm');
});
