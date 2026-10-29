import fs from "fs";
import { baselineRef, chapterEvents, deliverEvents, openLedger, sendDiscord } from "./discord-delivery.mjs";
import { waitForChapter } from "./wait-for-chapter.mjs";
import { execFileSync } from "child_process";
import { mangaUrl as mangaPath, chapterUrl as chapterPath } from "../assets/js/route-urls.mjs";

const webhook = process.env.DISCORD_WEBHOOK;

const dataPath = "assets/data/data.json";
function getJsonFromGit(ref) {
    try {
        const content = execFileSync(
            "git",
            ["show", `${ref}:${dataPath}`],
            { encoding: "utf8" }
        );

        return JSON.parse(content);
    } catch (error) {
        throw new Error(
            `Cannot read previous catalogue at ${ref}; refusing to notify every chapter.`,
            { cause: error }
        );
    }
}

const currentData = JSON.parse(
    fs.readFileSync(dataPath, "utf8")
);

const previousData = getJsonFromGit(baselineRef);
const newChapters = chapterEvents(currentData, previousData);
const pushPayloads = [];

if (newChapters.length === 0) {
    console.log("No new chapters found.");
    process.exit(0);
}

if (!webhook) {
    throw new Error("DISCORD_WEBHOOK is missing.");
}

console.log(
    `Found ${newChapters.length} new chapter(s).`
);

const ledger = await openLedger();
const chapterAddress = item => 'https://heliumtg.com' + chapterPath(item.slug, item.chapter.id);
await deliverEvents(newChapters, ledger.state, {
    save: ledger.save,
    ready: item => waitForChapter(chapterAddress(item)),
    send: async item => {
        const { slug, manga, chapter } = item;
        const mangaUrl = 'https://heliumtg.com' + mangaPath(slug);
        const chapterUrl = chapterAddress(item);

        const payload = {
            content:
                `@everyone\n\n` +
                `✨ **[${manga.title}](<${mangaUrl}>)** vừa có chương mới nha các vịu ơ!\n\n` +
                `💗 **[${chapter.title}](${chapterUrl})**\n\n` +
                `🌸 Ghé website ủng hộ HeliumTG nhé!\n\n` +
                chapterUrl,

            allowed_mentions: {
                parse: ["everyone"]
            }
        };

        await sendDiscord(webhook, payload);

        console.log(
            `Sent Discord notification: ${manga.title} - ${chapter.title}`
        );

    },
    onDelivered: async item => {
        const { slug, manga, chapter } = item;
        const chapterUrl = chapterAddress(item);
        let cover = "";
        if (typeof manga.cover === "string" && manga.cover.trim()) {
            try {
                const candidate = new URL(manga.cover, "https://heliumtg.com/");
                if (candidate.protocol === "https:" && !candidate.username && !candidate.password &&
                    ["https://heliumtg.com", "https://pub-a0cc60d51c6e4ebab81ee134d3dada9e.r2.dev"].includes(candidate.origin)) {
                    cover = candidate.href;
                }
            } catch { /* Missing/invalid cover must not prevent chapter delivery. */ }
    }
    pushPayloads.push({
        mangaSlug: slug,
        mangaTitle: manga.title,
        chapterTitle: chapter.title,
        url: chapterUrl,
        cover
    });
    }
});

// Hand off only after every chapter has passed readiness and Discord delivery.
// The file lives in RUNNER_TEMP, outside the deployed website.
if (process.env.PUSH_PAYLOAD_FILE) {
    fs.writeFileSync(process.env.PUSH_PAYLOAD_FILE, JSON.stringify(pushPayloads));
}
