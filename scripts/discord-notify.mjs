import fs from "fs";
import { execSync } from "child_process";

const webhook = process.env.DISCORD_WEBHOOK;

if (!webhook) {
    throw new Error("DISCORD_WEBHOOK is missing.");
}

const dataPath = "assets/data/data.json";

function getJsonFromGit(ref) {
    try {
        const content = execSync(
            `git show ${ref}:${dataPath}`,
            { encoding: "utf8" }
        );

        return JSON.parse(content);
    } catch {
        return {};
    }
}

const currentData = JSON.parse(
    fs.readFileSync(dataPath, "utf8")
);

const previousData = getJsonFromGit("HEAD^");

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

console.log(
    `Found ${newChapters.length} new chapter(s).`
);

for (const item of newChapters) {
    const { slug, manga, chapter } = item;

    const chapterUrl =
    `https://heliumtg.com/chapter.html?id=${slug}&chap=${chapter.id}`;

    const embed = {
        title: manga.title,
        url: chapterUrl,
        description:
            `🚀 **${manga.title}** vừa có chương mới nha các vịu ơ!\n\n` +
            `🔥 **${chapter.title}**`,
        color: 0x5865F2,
        image: {
            url: manga.cover
        },
        footer: {
            text: "HeliumTG"
        },
        timestamp: chapter.createAt
    };

    const payload = {
        content: "@everyone",
        allowed_mentions: {
            parse: ["everyone"]
        },
        embeds: [embed]
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