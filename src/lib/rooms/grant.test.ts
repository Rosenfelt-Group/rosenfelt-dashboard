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

  it("rejects structurally malformed input as malformed", () => {
    for (const bad of ["", "a.b", "a.b.c.d", "...", "x.notanumber.y", "x..y", ".1.y", "x.1.", "x.1234567890123.y", "é"]) {
      expect(verifyGrant(bad, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("rejects well-shaped but unsigned input as bad_signature", () => {
    for (const bad of ["a.1.c", "é.1.é", "x.0.y"]) {
      expect(verifyGrant(bad, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    }
  });

  it("rejects non-string and oversized grants without throwing", () => {
    const bad: unknown[] = [undefined, null, 42, ["a", "b", "c"], {}, "a".repeat(513)];
    for (const g of bad) {
      expect(() => verifyGrant(g as string, SECRET, NOW)).not.toThrow();
      expect(verifyGrant(g as string, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("enforces the 512-char length bound on well-shaped grants", () => {
    const shaped = (len: number) => `${"a".repeat(255)}.1.${"b".repeat(len - 258)}`;
    expect(verifyGrant(shaped(512), SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(shaped(512)).toHaveLength(512);
    expect(verifyGrant(shaped(513), SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyGrant(`${"a".repeat(300)}.1.${"b".repeat(300)}`, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("fails closed when nowMs is not a finite number", () => {
    const g = signGrant(PREFIX, SECRET, NOW);
    for (const n of [NaN, Infinity, -Infinity, null, undefined as unknown as number]) {
      expect(verifyGrant(g, SECRET, (n === undefined ? NaN : n) as number)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("rejects an empty or non-string secret as malformed", () => {
    const g = signGrant(PREFIX, SECRET, NOW);
    expect(verifyGrant(g, "", NOW)).toEqual({ ok: false, reason: "malformed" });
    for (const bad of [undefined, null, 42, {}]) {
      expect(verifyGrant(g, bad as unknown as string, NOW)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("treats the exact expiry instant as expired and one ms earlier as valid", () => {
    const g = signGrant(PREFIX, SECRET, NOW);
    const expMs = (NOW / 1000 + GRANT_TTL_SEC) * 1000;
    expect(verifyGrant(g, SECRET, expMs)).toEqual({ ok: false, reason: "expired" });
    expect(verifyGrant(g, SECRET, expMs - 1).ok).toBe(true);
  });

  it("rejects a correct-length wrong signature, and truncated or oversized signatures", () => {
    const [p, exp, sig] = signGrant(PREFIX, SECRET, NOW).split(".");
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(flipped).toHaveLength(sig.length);
    for (const bad of [flipped, sig.slice(0, -1), sig + "A"]) {
      expect(verifyGrant(`${p}.${exp}.${bad}`, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    }
  });

  it("rejects a leading-zero expiry carrying the original signature", () => {
    const [p, exp, sig] = signGrant(PREFIX, SECRET, NOW).split(".");
    expect(verifyGrant(`${p}.0${exp}.${sig}`, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("validates nowMs and ttlSec when signing", () => {
    for (const n of [NaN, Infinity, -Infinity]) expect(() => signGrant(PREFIX, SECRET, n)).toThrow();
    for (const t of [NaN, Infinity, 0, -5, 901, 1.5]) expect(() => signGrant(PREFIX, SECRET, NOW, t)).toThrow();
    for (const t of [1, GRANT_TTL_SEC]) {
      const g = signGrant(PREFIX, SECRET, NOW, t);
      expect(verifyGrant(g, SECRET, NOW)).toEqual({ ok: true, prefix: PREFIX, exp: NOW / 1000 + t });
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
