import { describe, it, expect, afterEach } from "vitest";
import { generateToken, hashToken, isPlausibleToken, roomLink } from "./token";

describe("token", () => {
  afterEach(() => { delete process.env.NEXT_PUBLIC_PORTAL_URL; });

  it("generates 43-char base64url tokens that differ each time", () => {
    const a = generateToken(), b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("hashes to 64 hex chars, deterministically, and never equals the raw token", () => {
    const raw = generateToken();
    expect(hashToken(raw)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(raw)).toBe(hashToken(raw));
    expect(hashToken(raw)).not.toContain(raw);
  });

  it("rejects implausible tokens before any lookup", () => {
    expect(isPlausibleToken(generateToken())).toBe(true);
    for (const bad of ["", "short", "a".repeat(44), "a".repeat(42) + "!", "../etc/passwd"]) {
      expect(isPlausibleToken(bad)).toBe(false);
    }
  });

  it("builds the link on the portal host", () => {
    process.env.NEXT_PUBLIC_PORTAL_URL = "https://portal.example.com/";
    expect(roomLink("abc")).toBe("https://portal.example.com/r/abc");
  });

  it("defaults to portal.rosably.com", () => {
    expect(roomLink("abc")).toBe("https://portal.rosably.com/r/abc");
  });
});
