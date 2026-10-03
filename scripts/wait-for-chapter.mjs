import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const run = promisify(execFile);
const decode = value => value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_, entity) => {
    if (entity.startsWith("#")) return String.fromCodePoint(entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
    return { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" }[entity.toLowerCase()];
});

export function ogMetadata(html) {
    const values = {};
    for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
        const attributes = {};
        for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)) {
            attributes[match[1].toLowerCase()] = decode(match[3]);
        }
        const key = attributes.property;
        if (!key?.startsWith("og:")) continue;
        if (key in values) throw new Error(`Duplicate metadata: ${key}`);
        values[key] = attributes.content;
    }
    return values;
}

export function verifyMetadata(html, expected, chapterUrl) {
    const actual = ogMetadata(html);
    for (const key of ["og:url", "og:title", "og:description", "og:type", "og:image"]) {
        if (!expected[key] || actual[key] !== expected[key]) throw new Error(`Missing or stale ${key}`);
    }
    if (actual["og:url"] !== chapterUrl || actual["og:type"] !== "article") {
        throw new Error("Page does not match the new chapter URL");
    }
    const image = new URL(actual["og:image"]);
    if (image.protocol !== "https:") throw new Error("OG image must use HTTPS");
    return image.href;
}

// GET the exact URL Discord receives, without cache-busting query parameters.
export async function waitForChapter(chapterUrl, {
    timeoutMs = 300_000, intervalMs = 10_000,
    request = curlGet, pause = sleep,
    expectedHtml = fs.readFileSync(path.join(".", ...new URL(chapterUrl).pathname.split("/").filter(Boolean).map(decodeURIComponent), "index.html"), "utf8")
} = {}) {
    const expected = ogMetadata(expectedHtml);
    verifyMetadata(expectedHtml, expected, chapterUrl);
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
        try {
            const page = await request(chapterUrl, Math.min(20_000, deadline - Date.now()));
            if (page.status !== 200) throw new Error(`Chapter HTTP ${page.status}`);
            const imageUrl = verifyMetadata(page.body, expected, chapterUrl);
            if (Date.now() >= deadline) throw new Error("Readiness deadline reached");
            const image = await request(imageUrl, Math.min(20_000, deadline - Date.now()), true);
            if (image.status !== 200 || !image.contentType.startsWith("image/") || image.size === 0) {
                throw new Error(`OG image unavailable: HTTP ${image.status}, ${image.contentType}`);
            }
            console.log(`Chapter and OG image ready: ${chapterUrl}`);
            return;
        } catch (error) {
            lastError = error;
            console.log(`Waiting for ${chapterUrl}: ${error.message}`);
        }
        const remaining = deadline - Date.now();
        if (remaining > 0) await pause(Math.min(intervalMs, remaining));
    }
    throw new Error(`Chapter not ready after ${timeoutMs / 1000}s: ${chapterUrl}`, { cause: lastError });
}

async function curlGet(url, timeoutMs, image = false) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chapter-ready-"));
    const output = path.join(directory, "response");
    try {
        const { stdout } = await run("curl", [
            "--silent", "--show-error", "--location", "--proto", "=https", "--proto-redir", "=https",
            "--connect-timeout", "5", "--max-time", String(Math.max(0.001, timeoutMs / 1000)),
            "--header", "Cache-Control: no-cache", "--output", output,
            "--write-out", "%{http_code}\n%{content_type}", url
        ]);
        const [status, contentType = ""] = stdout.trim().split("\n");
        return { status: Number(status), contentType, size: fs.statSync(output).size,
            body: image ? "" : fs.readFileSync(output, "utf8") };
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
