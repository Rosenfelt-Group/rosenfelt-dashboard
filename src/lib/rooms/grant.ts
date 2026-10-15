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

// ---- Document download grants ----
// Shape: "d1" . base64url(path) . base64url(filename) . expiry . MAC, where the MAC covers a
// domain-prefixed string. A prototype grant (3 parts, plain MAC) can never verify as a document
// grant, and a document grant can never verify as a prototype grant.
export const DOC_GRANT_TTL_SEC = 120;

export const DOC_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
} as const;
export type DocExt = keyof typeof DOC_TYPES;
export const DOC_EXTS = Object.keys(DOC_TYPES) as DocExt[];

const DOC_PATH_RE = new RegExp(`^${UUID}/${UUID}/${UUID}/document\\.(?:${Object.keys(DOC_TYPES).join("|")})$`);
const DOC_MAC_DOMAIN = "rooms-document-grant-v1\n";
// Control characters, path separators, quotes, backslash and bidi overrides (which can disguise an extension).
const UNSAFE_NAME_RE = /[\x00-\x1f\x7f/\\"\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

export type DocGrantResult =
  | { ok: true; path: string; filename: string; exp: number }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function isSafeDocFilename(name: unknown): name is string {
  return typeof name === "string" && name.length >= 1 && name.length <= 150
    && !UNSAFE_NAME_RE.test(name) && !name.startsWith(".") && name.trim() === name;
}

export function signDocGrant(
  path: string,
  filename: string,
  secret: string,
  nowMs: number = Date.now(),
  ttlSec: number = DOC_GRANT_TTL_SEC,
): string {
  if (!DOC_PATH_RE.test(path)) throw new Error("invalid document path");
  if (!isSafeDocFilename(filename)) throw new Error("invalid document filename");
  if (!secret) throw new Error("grant secret missing");
  if (!Number.isFinite(nowMs)) throw new Error("invalid nowMs");
  if (!Number.isInteger(ttlSec) || ttlSec < 1 || ttlSec > DOC_GRANT_TTL_SEC) throw new Error("invalid ttlSec");
  const exp = Math.floor(nowMs / 1000) + ttlSec;
  const payload = `d1.${b64(path)}.${b64(filename)}.${exp}`;
  return `${payload}.${mac(secret, DOC_MAC_DOMAIN + payload)}`;
}

export function verifyDocGrant(grant: string, secret: string, nowMs: number = Date.now()): DocGrantResult {
  if (typeof grant !== "string" || grant.length === 0 || grant.length > 2048) return { ok: false, reason: "malformed" };
  if (typeof secret !== "string" || secret.length === 0) return { ok: false, reason: "malformed" };
  if (!Number.isFinite(nowMs)) return { ok: false, reason: "malformed" };
  const parts = grant.split(".");
  if (parts.length !== 5 || parts[0] !== "d1") return { ok: false, reason: "malformed" };
  const [, p, f, expStr, sig] = parts;
  if (!p || !f || !sig || !/^\d{1,12}$/.test(expStr)) return { ok: false, reason: "malformed" };

  const a = Buffer.from(sig);
  const b = Buffer.from(mac(secret, `${DOC_MAC_DOMAIN}d1.${p}.${f}.${expStr}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };

  const exp = Number(expStr);
  if (exp * 1000 <= nowMs) return { ok: false, reason: "expired" };

  const path = unb64(p);
  const filename = unb64(f);
  if (!DOC_PATH_RE.test(path) || !isSafeDocFilename(filename)) return { ok: false, reason: "malformed" };
  return { ok: true, path, filename, exp };
}

// ---- Preview-room tokens ----
// Shape: "p1" . base64url(engagement id) . expiry . MAC (4 parts), MAC over a domain-prefixed string.
// A prototype grant (3 parts) and a document grant (5 parts, "d1") can never verify as a preview
// token, and a preview token can never verify as either of them.
export const PREVIEW_TOKEN_TTL_SEC = 300;
const PREVIEW_MAC_DOMAIN = "rooms-preview-v1\n";
const UUID_RE = new RegExp(`^${UUID}$`);

export type PreviewTokenResult =
  | { ok: true; eid: string; exp: number }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function signPreviewToken(
  eid: string,
  secret: string,
  nowMs: number = Date.now(),
  ttlSec: number = PREVIEW_TOKEN_TTL_SEC,
): string {
  if (!UUID_RE.test(eid)) throw new Error("invalid engagement id");
  if (!secret) throw new Error("grant secret missing");
  if (!Number.isFinite(nowMs)) throw new Error("invalid nowMs");
  if (!Number.isInteger(ttlSec) || ttlSec < 1 || ttlSec > PREVIEW_TOKEN_TTL_SEC) throw new Error("invalid ttlSec");
  const exp = Math.floor(nowMs / 1000) + ttlSec;
  const payload = `p1.${b64(eid)}.${exp}`;
  return `${payload}.${mac(secret, PREVIEW_MAC_DOMAIN + payload)}`;
}

export function verifyPreviewToken(token: string, secret: string, nowMs: number = Date.now()): PreviewTokenResult {
  if (typeof token !== "string" || token.length === 0 || token.length > 512) return { ok: false, reason: "malformed" };
  if (typeof secret !== "string" || secret.length === 0) return { ok: false, reason: "malformed" };
  if (!Number.isFinite(nowMs)) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "p1") return { ok: false, reason: "malformed" };
  const [, p, expStr, sig] = parts;
  if (!p || !sig || !/^\d{1,12}$/.test(expStr)) return { ok: false, reason: "malformed" };

  const a = Buffer.from(sig);
  const b = Buffer.from(mac(secret, `${PREVIEW_MAC_DOMAIN}p1.${p}.${expStr}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };

  const exp = Number(expStr);
  if (exp * 1000 <= nowMs) return { ok: false, reason: "expired" };

  const eid = unb64(p);
  if (!UUID_RE.test(eid)) return { ok: false, reason: "malformed" };
  return { ok: true, eid, exp };
}
