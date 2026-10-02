import fs from "fs";
import { execFileSync } from "child_process";
import { mangaUrl as mangaPath, chapterUrl as chapterPath } from "../assets/js/route-urls.mjs";

const webhook = process.env.DISCORD_WEBHOOK;

const dataPath = "assets/data/data.json";
const pushBefore = process.env.PUSH_BEFORE;

if (pushBefore && !/^[a-f0-9]{40}$/i.test(pushBefore)) {
    throw new Error("PUSH_BEFORE must be a commit SHA.");
}

if (pushBefore === "0".repeat(40)) {
    console.log("No previous push commit; skipping Discord notifications.");
    process.exit(0);
}

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

const previousData = getJsonFromGit(pushBefore || "HEAD^");

const newChapters = [];

for (const [slug, manga] of Object.entries(currentData)) {
    const oldManga = previousData[slug];

    const oldChapters = oldManga?.chapters || [];
    const currentChapters = manga.chapters || [];

    const oldIds = new Set(
        oldChapters.map(chapter => String(chapter.id))
    );

    for (const chapter of currentChapters) {
        if (!oldIds.has(String(chapter.id))) {
            newChapters.push({
                slug,
                manga,
                chapter
            });
        }
    }
}

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

for (const item of newChapters) {
    const { slug, manga, chapter } = item;

    const mangaUrl =
        `https://heliumtg.com${mangaPath(slug)}`;

    const chapterUrl =
        `https://heliumtg.com${chapterPath(slug, chapter.id)}`;

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

    const response = await fetch(webhook, {
        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const error = await response.text();

        throw new Error(
            `Discord error ${response.status}: ${error}`
        );
    }

    console.log(
        `Sent Discord notification: ${manga.title} - ${chapter.title}`
    );
}
