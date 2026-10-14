import { createHmac, timingSafeEqual } from "node:crypto";

export const GRANT_TTL_SEC = 900;

const UUID = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const PREFIX_RE = new RegExp(`^${UUID}/${UUID}/v[1-9][0-9]{0,5}$`);

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const mac = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

export type GrantResult =
  | { ok: true; prefix: string; exp: number }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

// Grant = base64url(prefix) . expiry(unix seconds) . HMAC-SHA256(secret, "<b64prefix>.<expiry>")
// The prefix is "{engagement}/{deliverable}/v{n}": it pins the grant to one version
// without the preview host ever needing the database.
export function signGrant(
  prefix: string,
  secret: string,
  nowMs: number = Date.now(),
  ttlSec: number = GRANT_TTL_SEC,
): string {
  if (!PREFIX_RE.test(prefix)) throw new Error("invalid storage prefix");
  if (!secret) throw new Error("grant secret missing");
  if (!Number.isFinite(nowMs)) throw new Error("invalid nowMs");
  if (!Number.isInteger(ttlSec) || ttlSec < 1 || ttlSec > GRANT_TTL_SEC) throw new Error("invalid ttlSec");
  const exp = Math.floor(nowMs / 1000) + ttlSec;
  const payload = `${b64(prefix)}.${exp}`;
  return `${payload}.${mac(secret, payload)}`;
}

export function verifyGrant(grant: string, secret: string, nowMs: number = Date.now()): GrantResult {
  if (typeof grant !== "string" || grant.length === 0 || grant.length > 512) return { ok: false, reason: "malformed" };
  if (typeof secret !== "string" || secret.length === 0) return { ok: false, reason: "malformed" };
  if (!Number.isFinite(nowMs)) return { ok: false, reason: "malformed" };
  const parts = grant.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [p, expStr, sig] = parts;
  if (!p || !sig || !/^\d{1,12}$/.test(expStr)) return { ok: false, reason: "malformed" };

  const a = Buffer.from(sig);
  const b = Buffer.from(mac(secret, `${p}.${expStr}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };

  const exp = Number(expStr);
  if (exp * 1000 <= nowMs) return { ok: false, reason: "expired" };

  const prefix = unb64(p);
  if (!PREFIX_RE.test(prefix)) return { ok: false, reason: "malformed" };
  return { ok: true, prefix, exp };
}
