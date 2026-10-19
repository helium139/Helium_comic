// Operator-only one-time OAuth helper. Never imported by deployed Functions.
import {createServer} from "node:http";
import {randomBytes, createHash, timingSafeEqual} from "node:crypto";
import {readFile, writeFile, mkdtemp, chmod} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
const argv = process.argv.slice(2);
if (argv[0] !== "--client-json" || !argv[1] || !argv.includes("--authorize-owner")) throw new Error("Use --client-json /outside/repo/client.json --authorize-owner [--create-folder]");
let client;
try {
  client = JSON.parse(await readFile(argv[1], "utf8")).installed;
} catch {
  throw new Error("Cannot read valid Desktop OAuth client JSON");
}
if (!client?.client_id || !client.client_secret) throw new Error("A Desktop OAuth client JSON is required");
const state = randomBytes(32).toString("base64url");
const verifier = randomBytes(48).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
let resolveCode; let rejectCode;
const codeReady = new Promise((resolve, reject) => {
  resolveCode = resolve; rejectCode = reject;
});
const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    const value = url.searchParams.get("state") || "";
    if (url.pathname !== "/oauth2callback" || value.length !== state.length || !timingSafeEqual(Buffer.from(value), Buffer.from(state)) || !url.searchParams.get("code")) {
      response.writeHead(400); response.end("Invalid authorization response"); return;
    }
    response.end("Authorization received. Return to your terminal.");
    resolveCode(url.searchParams.get("code"));
  } catch {
    response.writeHead(400); response.end("Invalid callback");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const redirect = `http://127.0.0.1:${server.address().port}/oauth2callback`;
const timeout = setTimeout(() => rejectCode(new Error("Authorization timed out")), 10 * 60_000);
const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
url.search = new URLSearchParams({client_id: client.client_id, redirect_uri: redirect, response_type: "code", access_type: "offline", prompt: "consent",
  scope: "https://www.googleapis.com/auth/drive.file", state, code_challenge: challenge, code_challenge_method: "S256"}).toString();
console.log("Open this URL locally in the report owner's browser (never paste the callback/tokens into chat):");
console.log(url.toString()); // Authorization URL contains no client secret, code, or token.
try {
  const code = await codeReady;
  const response = await fetch("https://oauth2.googleapis.com/token", {method: "POST", signal: AbortSignal.timeout(20000),
    body: new URLSearchParams({code, client_id: client.client_id, client_secret: client.client_secret, redirect_uri: redirect, grant_type: "authorization_code", code_verifier: verifier})});
  if (!response.ok) throw new Error("Token exchange failed; no credentials printed");
  const credentials = await response.json();
  if (!credentials.refresh_token) throw new Error("No refresh token; repeat owner consent with offline access");
  const directory = await mkdtemp(join(tmpdir(), "helium-report-oauth-"));
  await chmod(directory, 0o700);
  for (const [name, value] of [["GOOGLE_REPORT_CLIENT_ID", client.client_id], ["GOOGLE_REPORT_CLIENT_SECRET", client.client_secret], ["GOOGLE_REPORT_REFRESH_TOKEN", credentials.refresh_token]]) {
    await writeFile(join(directory, name), value, {mode: 0o600, flag: "wx"});
    console.log(`firebase functions:secrets:set ${name} --project helium-team-d7f80 --data-file ${join(directory, name)}`);
  }
  if (argv.includes("--create-folder")) {
    const folder = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {method: "POST", signal: AbortSignal.timeout(20000),
      headers: {"Authorization": `Bearer ${credentials.access_token}`, "Content-Type": "application/json"},
      body: JSON.stringify({name: "HeliumTG Monthly Reports", mimeType: "application/vnd.google-apps.folder"})});
    if (!folder.ok) throw new Error("Folder creation failed; use the same app to authorize/create a private owner folder");
    console.log(`GOOGLE_REPORT_FOLDER_ID=${(await folder.json()).id}`); // Non-secret folder configuration only.
  }
  console.log("Secret files have owner-only permissions. Upload to Secret Manager, then remove the temporary directory and downloaded client JSON securely.");
} finally {
  clearTimeout(timeout); server.close();
}
