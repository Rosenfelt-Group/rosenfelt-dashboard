import { describe, it, expect } from "vitest";
import { signGrant, verifyGrant, GRANT_TTL_SEC } from "./grant";

const E = "0b6f1c0e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";
const D = "1c7a2d1f-3e4b-4c6d-9e8f-0a1b2c3d4e5f";
const PREFIX = `${E}/${D}/v3`;
const SECRET = "test-secret";
const NOW = 1_800_000_000_000;

describe("grant", () => {
  it("round-trips the prefix", () => {
    const g = signGrant(PREFIX, SECRET, NOW);
    expect(verifyGrant(g, SECRET, NOW + 1000)).toEqual({ ok: true, prefix: PREFIX, exp: NOW / 1000 + GRANT_TTL_SEC });
  });

  it("expires after the ttl", () => {
    const g = signGrant(PREFIX, SECRET, NOW);
    expect(verifyGrant(g, SECRET, NOW + (GRANT_TTL_SEC + 1) * 1000)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects the wrong secret", () => {
    const g = signGrant(PREFIX, SECRET, NOW);
    expect(verifyGrant(g, "other", NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a swapped prefix (grant for version A cannot read version B)", () => {
    const g = signGrant(PREFIX, SECRET, NOW);
    const [, exp, sig] = g.split(".");
    const other = Buffer.from(`${E}/${D}/v4`).toString("base64url");
    expect(verifyGrant(`${other}.${exp}.${sig}`, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a tampered expiry", () => {
    const g = signGrant(PREFIX, SECRET, NOW);
    const [p, exp, sig] = g.split(".");
    expect(verifyGrant(`${p}.${Number(exp) + 99999}.${sig}`, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "a.b", "a.b.c.d", "...", "x.notanumber.y"]) {
      expect(verifyGrant(bad, SECRET, NOW).ok).toBe(false);
    }
  });

  it("refuses to sign a prefix that is not engagement/deliverable/vN", () => {
    for (const bad of ["", "../x", `${E}/${D}`, `${E}/${D}/v0`, `${E}/${D}/v1/extra`, `${E}/../v1`]) {
      expect(() => signGrant(bad, SECRET, NOW)).toThrow();
    }
  });

  it("refuses to sign with an empty secret", () => {
    expect(() => signGrant(PREFIX, "", NOW)).toThrow();
  });
});
