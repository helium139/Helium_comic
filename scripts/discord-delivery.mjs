import { setTimeout as sleep } from 'node:timers/promises';
import { chapterUrl } from '../assets/js/route-urls.mjs';

// Rollout baseline: existing chapters are historical, not a notification backlog.
export const baselineRef = 'af112690c17ac790b28467b76bae390dab4bca6a';
export const eventKey = (slug, id) => JSON.stringify([slug, String(id), chapterUrl(slug, id)]);

export function chapterEvents(current, baseline) {
    const events = new Map();
    for (const [slug, manga] of Object.entries(current)) {
        const old = new Set((baseline[slug]?.chapters || []).map(c => String(c.id)));
        for (const chapter of manga.chapters || []) {
            if (!old.has(String(chapter.id))) {
                const key = eventKey(slug, chapter.id);
                events.set(key, { key, slug, manga, chapter });
            }
        }
    }
    const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    return [...events.values()].sort((a, b) => compare(a.slug, b.slug) ||
        (Number(a.chapter.id) - Number(b.chapter.id) || compare(String(a.chapter.id), String(b.chapter.id))));
}

export async function deliverEvents(events, state, { ready, send, save, onDelivered = async () => {} }) {
    for (const event of events) {
        if (!state.delivered[event.key]) {
            await ready(event);
            await send(event);
            const next = { ...state, delivered: { ...state.delivered, [event.key]: true } };
            await save(next);
            state.delivered = next.delivered;
        }
        // Include previously delivered Discord events so a failed Firebase handoff can retry.
        await onDelivered(event);
    }
}

export async function sendDiscord(webhook, payload, { request = fetch, pause = sleep, attempts = 6 } = {}) {
    const url = new URL(webhook);
    url.searchParams.set('wait', 'true');
    for (let attempt = 0; attempt < attempts; attempt++) {
        let response;
        try {
            response = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000) });
        } catch {
            // A transport failure can be ambiguous; do not blindly repeat a possibly accepted POST.
            throw new Error('Discord transport failed; delivery was not recorded.');
        }
        if (response.ok) return;
        if (response.status !== 429 || attempt === attempts - 1) {
            throw new Error(`Discord delivery failed (HTTP ${response.status}); delivery was not recorded.`);
        }
        const body = await response.json().catch(() => ({}));
        const seconds = Math.max(Number(response.headers.get('Retry-After')) || 0, Number(body.retry_after) || 0);
        await pause(Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 1000);
    }
}

// Durable state is isolated from main and the deployed website. The workflow's
// pages-release concurrency group serializes all readers/writers; SHA is a CAS guard.
export async function openLedger({ repository = process.env.GITHUB_REPOSITORY,
    token = process.env.GITHUB_TOKEN, request = fetch } = {}) {
    if (!repository || !token) throw new Error('GitHub repository/token required for durable Discord dedupe.');
    const branch = 'discord-delivery-state';
    const file = 'discord-delivery.json';
    const api = async (route, method = 'GET', body) => {
        let response;
        try {
            response = await request(`https://api.github.com/repos/${repository}/${route}`, {
                method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
                    'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
                body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000)
            });
        } catch { throw new Error('Discord ledger request failed.'); }
        if (response.status === 404 && method === 'GET') return null;
        if (!response.ok) {
            const responseBody = await response.text();
            let message = '';
            try {
                const details = JSON.parse(responseBody);
                if (typeof details.message === 'string') message = details.message;
            } catch (error) {
                if (!(error instanceof SyntaxError)) throw error;
            }
            message = message
                .replaceAll(token, '[REDACTED]')
                .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED]')
                .slice(0, 500);
            const endpoint = route.split('?')[0];
            throw new Error(`Discord ledger ${method} /${endpoint} failed (HTTP ${response.status})${message ? `: ${message}` : ''}.`);
        }
        return response.json();
    };
    if (!await api(`git/ref/heads/${branch}`)) {
        await api('git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: baselineRef });
    }
    const stored = await api(`contents/${file}?ref=${branch}`);
    let sha = stored?.sha;
    const state = stored ? JSON.parse(Buffer.from(stored.content, 'base64').toString('utf8')) :
        { baseline: baselineRef, delivered: {} };
    if (state.baseline !== baselineRef || !state.delivered || typeof state.delivered !== 'object' || Array.isArray(state.delivered)) {
        throw new Error('Invalid Discord ledger; refusing to send without dedupe.');
    }
    const save = async next => {
        const result = await api(`contents/${file}`, 'PUT', { branch, sha,
            message: 'Record confirmed Discord chapter deliveries',
            content: Buffer.from(JSON.stringify(next)).toString('base64') });
        sha = result.content.sha;
    };
    if (!stored) await save(state);
    return { state, save };
}
