import {createHash, createHmac, timingSafeEqual} from "node:crypto";
const allowed=new Set(["startChapterViewSession", "recordChapterView"]);
const digest=(text)=>createHash("sha256").update(text).digest("hex");
const mac=(secret, name, body, context)=>createHmac("sha256", secret).update(JSON.stringify(["migration-bridge-v1", name, digest(body), context])).digest("hex");
export function signedBridgeHeaders(secret, name, body, {uid=null, network, at=Date.now()}) {
  if (!allowed.has(name)||!network) throw Error("Invalid view bridge request");
  const context={uid, network, at}; const serialized=Buffer.from(JSON.stringify(context)).toString("base64url");
  return {"X-Helium-View-Context": serialized, "X-Helium-View-Signature": mac(secret, name, body, context)};
}
export function verifyBridge(secret, name, body, headers, now=Date.now()) {
  const contextHeader=headers.get("X-Helium-View-Context"); const signature=headers.get("X-Helium-View-Signature");
  if (!contextHeader&&!signature) return null;
  try {
    if (!allowed.has(name)||!contextHeader||contextHeader.length>1024||!/^[a-f0-9]{64}$/.test(signature||"")) throw Error();
    const context=JSON.parse(Buffer.from(contextHeader, "base64url").toString());
    if (!Number.isSafeInteger(context.at)||Math.abs(now-context.at)>30000||typeof context.network!=="string"||context.network.length>128||!context.network||context.uid!==null&&typeof context.uid!=="string") throw Error();
    const expected=mac(secret, name, body, context); if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"))) throw Error();
    return context;
  } catch {
    const e=Error("Invalid view migration bridge"); e.code="unauthenticated"; throw e;
  }
}
export async function forwardView({url, name, secret, data, uid, network, authorization, appCheck, fetchImpl=fetch}) {
  const base=new URL(url); if (base.protocol!=="https:"||base.username||base.password||base.search||base.hash||!allowed.has(name)) throw Error("Reviewed Worker URL required");
  const body=JSON.stringify({data}); const headers={"Content-Type": "application/json", ...signedBridgeHeaders(secret, name, body, {uid: uid||null, network})};
  if (authorization)headers.Authorization=authorization; if (appCheck)headers["X-Firebase-AppCheck"]=appCheck;
  const response=await fetchImpl(new URL(name, base.href.replace(/\/?$/, "/")), {method: "POST", headers, body, signal: AbortSignal.timeout(25000)});
  const result=await response.json(); if (!response.ok||result.error) {
    const e=Error("Migrated view temporarily unavailable"); e.code=(result.error?.status||"unavailable").toLowerCase().replaceAll("_", "-"); throw e;
  }
  if (!Object.hasOwn(result, "result")) throw Error("Malformed migration response"); return result.result;
}
