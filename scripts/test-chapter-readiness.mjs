import test from "node:test";
import assert from "node:assert/strict";
import { ogMetadata, verifyMetadata, waitForChapter } from "./wait-for-chapter.mjs";

const url = "https://heliumtg.com/manga/example/chapter/2/";
const imageUrl = "https://heliumtg.com/assets/og/example.png";
const html = `<meta property="og:url" content="${url}">
<meta property="og:title" content="Example &amp; chapter 2">
<meta property="og:description" content="New chapter">
<meta property="og:type" content="article">
<meta property="og:image" content="${imageUrl}">`;
const page = { status: 200, body: html };
const image = { status: 200, contentType: "image/png", size: 100 };

test("metadata identifies the chapter and rejects stale or missing tags", () => {
    const expected = ogMetadata(html);
    assert.equal(expected["og:title"], "Example & chapter 2");
    assert.equal(verifyMetadata(html, expected, url), imageUrl);
    for (const stale of [html.replace("chapter/2/", "chapter/1/"), html.replace("chapter 2", "chapter 1"), html.replace('property="og:image"', 'property="missing"'), html + `<meta property="og:image" content="${imageUrl}">`]) {
        assert.throws(() => verifyMetadata(stale, expected, url));
    }
});

test("retries page 404, stale HTML, and image 404 before succeeding", async () => {
    const calls = [];
    const responses = [{ status: 404 }, { status: 200, body: html.replace("chapter 2", "chapter 1") }, page, { status: 404 }, page, image];
    await waitForChapter(url, { expectedHtml: html, intervalMs: 0, timeoutMs: 1000,
        request: async requested => { calls.push(requested); return responses.shift(); } });
    assert.deepEqual(calls, [url, url, url, imageUrl, url, imageUrl]);
});

test("timeout prevents continuing to a webhook", async () => {
    await assert.rejects(waitForChapter(url, { expectedHtml: html, timeoutMs: 15, intervalMs: 5,
        request: async () => ({ status: 404 }) }), /Chapter not ready/);
});

test("rejects empty and non-image responses", async () => {
    for (const invalid of [{ ...image, size: 0 }, { ...image, contentType: "text/html" }]) {
        await assert.rejects(waitForChapter(url, { expectedHtml: html, timeoutMs: 10, intervalMs: 5,
            request: async requested => requested === url ? page : invalid }), /Chapter not ready/);
    }
});
