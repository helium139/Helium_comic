import { readFile } from "node:fs/promises";
// Browser helpers are plain ESM; load unchanged source without a package.json migration.
const source = await readFile(new URL("../assets/js/teams.js", import.meta.url), "utf8");
const { normalizeTeams, validateCatalogue } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const teams = normalizeTeams(await read("../assets/data/teams.json"));
const count = validateCatalogue(await read("../assets/data/data.json"), teams);
console.log(`Validated ${count} manga across ${teams.length} team(s).`);
