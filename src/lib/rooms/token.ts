import { createHash, randomBytes } from "node:crypto";

// 32 random bytes → 43 base64url chars. Only the SHA-256 hash is ever stored.
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function isPlausibleToken(raw: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(raw);
}

export function roomLink(raw: string): string {
  const base = (process.env.NEXT_PUBLIC_PORTAL_URL ?? "https://portal.rosably.com").replace(/\/$/, "");
  return `${base}/r/${raw}`;
}

export function previewRoomLink(token: string): string {
  const base = (process.env.NEXT_PUBLIC_PORTAL_URL ?? "https://portal.rosably.com").replace(/\/$/, "");
  return `${base}/preview/${token}`;
}
