import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { signGrant, verifyGrant, GRANT_TTL_SEC, signDocGrant, verifyDocGrant, isSafeDocFilename, DOC_GRANT_TTL_SEC, DOC_TYPES, DOC_EXTS, signPreviewToken, verifyPreviewToken, PREVIEW_TOKEN_TTL_SEC } from "./grant";

const E = "0b6f1c0e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";
const D = "1c7a2d1f-3e4b-4c6d-9e8f-0a1b2c3d4e5f";
const PREFIX = `${E}/${D}/v3`;
const PREVIEW_PREFIX = PREFIX;
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

describe("document grant", () => {
  const U = "2d8b3e20-4f5c-4d7e-8f90-1b2c3d4e5f60";
  const PATH = `${E}/${D}/${U}/document.pdf`;

  it("round-trips path and filename", () => {
    const g = signDocGrant(PATH, "Proposal – 2026.pdf", SECRET, NOW);
    expect(verifyDocGrant(g, SECRET, NOW + 1000)).toEqual({ ok: true, path: PATH, filename: "Proposal – 2026.pdf", exp: NOW / 1000 + DOC_GRANT_TTL_SEC });
  });

  it("expires after 120 seconds and refuses a longer ttl", () => {
    const g = signDocGrant(PATH, "a.pdf", SECRET, NOW);
    expect(verifyDocGrant(g, SECRET, NOW + 121_000)).toEqual({ ok: false, reason: "expired" });
    expect(() => signDocGrant(PATH, "a.pdf", SECRET, NOW, 121)).toThrow();
  });

  it("rejects a wrong secret and a tampered filename", () => {
    const g = signDocGrant(PATH, "a.pdf", SECRET, NOW);
    expect(verifyDocGrant(g, "other", NOW)).toEqual({ ok: false, reason: "bad_signature" });
    const parts = g.split(".");
    parts[2] = Buffer.from("b.pdf").toString("base64url");
    expect(verifyDocGrant(parts.join("."), SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("is never interchangeable with a prototype grant", () => {
    const proto = signGrant(PREFIX, SECRET, NOW);
    const doc = signDocGrant(PATH, "a.pdf", SECRET, NOW);
    expect(verifyDocGrant(proto, SECRET, NOW).ok).toBe(false);
    expect(verifyGrant(doc, SECRET, NOW).ok).toBe(false);
  });

  it("uses a domain-separated MAC (a plain HMAC over the same payload does not verify)", () => {
    const doc = signDocGrant(PATH, "a.pdf", SECRET, NOW);
    const payload = doc.split(".").slice(0, 4).join(".");
    const plain = createHmac("sha256", SECRET).update(payload).digest("base64url");
    expect(verifyDocGrant(`${payload}.${plain}`, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("only signs document paths in the expected shape", () => {
    for (const bad of [PREFIX, `${E}/${D}/v3/document.pdf`, `${E}/${D}/${U}/document.exe`, `${E}/${D}/${U}/../document.pdf`,
      `${E}/${D}/${U}/other.pdf`, `${E}/${D}/${U}/document.PDF`, ""]) {
      expect(() => signDocGrant(bad, "a.pdf", SECRET, NOW)).toThrow();
    }
  });

  it("only signs safe filenames", () => {
    for (const bad of ["", ".hidden.pdf", "a/b.pdf", "a\\b.pdf", 'a"b.pdf', "a\r\nb.pdf", "evil\u202Efdp.pdf", " lead.pdf", "x".repeat(151)]) {
      expect(isSafeDocFilename(bad)).toBe(false);
      expect(() => signDocGrant(PATH, bad, SECRET, NOW)).toThrow();
    }
    expect(isSafeDocFilename("Résumé (final) – v2.pdf")).toBe(true);
  });

  it("maps every allowed extension to a MIME type", () => {
    expect([...DOC_EXTS].sort()).toEqual(["csv", "docx", "jpg", "md", "pdf", "png", "pptx", "txt", "xlsx"]);
    expect(DOC_TYPES.pdf).toBe("application/pdf");
    expect(DOC_TYPES.jpg).toBe("image/jpeg");
  });
});

describe("preview token", () => {
  const EID = "0b6f1c0e-2d3a-4b5c-8d7e-9f0a1b2c3d4e";
  it("round-trips the engagement id", () => {
    const t = signPreviewToken(EID, SECRET, NOW);
    expect(t.startsWith("p1.")).toBe(true);
    expect(verifyPreviewToken(t, SECRET, NOW + 1000)).toEqual({ ok: true, eid: EID, exp: NOW / 1000 + PREVIEW_TOKEN_TTL_SEC });
  });
  it("expires after the ttl", () => {
    const t = signPreviewToken(EID, SECRET, NOW);
    expect(verifyPreviewToken(t, SECRET, NOW + (PREVIEW_TOKEN_TTL_SEC + 1) * 1000)).toEqual({ ok: false, reason: "expired" });
  });
  it("rejects the wrong secret and any tampering", () => {
    const t = signPreviewToken(EID, SECRET, NOW);
    expect(verifyPreviewToken(t, "other", NOW)).toEqual({ ok: false, reason: "bad_signature" });
    const [p, e, x, sig] = t.split(".");
    const other = Buffer.from("1c7a2d1f-3e4b-4c6d-9e8f-0a1b2c3d4e5f").toString("base64url");
    expect(verifyPreviewToken([p, other, x, sig].join("."), SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyPreviewToken([p, e, String(Number(x) + 100), sig].join("."), SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("is domain-separated from prototype and document grants in both directions", () => {
    const t = signPreviewToken(EID, SECRET, NOW);
    expect(verifyGrant(t, SECRET, NOW).ok).toBe(false);
    expect(verifyDocGrant(t, SECRET, NOW).ok).toBe(false);
    const proto = signGrant(PREVIEW_PREFIX, SECRET, NOW);
    const doc = signDocGrant(`${E}/${D}/${E}/document.pdf`, "a.pdf", SECRET, NOW);
    expect(verifyPreviewToken(proto, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyPreviewToken(doc, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
  });
  it("rejects a MAC computed without the domain prefix", () => {
    const payload = `p1.${Buffer.from(EID).toString("base64url")}.${NOW / 1000 + 100}`;
    const bare = createHmac("sha256", SECRET).update(payload).digest("base64url");
    expect(verifyPreviewToken(`${payload}.${bare}`, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("rejects malformed input and refuses to sign bad input", () => {
    for (const bad of ["", "p1", "p1.a.b", "p2.a.1.c", "x".repeat(600), "p1..1.c"]) expect(verifyPreviewToken(bad, SECRET, NOW).ok).toBe(false);
    expect(() => signPreviewToken("not-a-uuid", SECRET, NOW)).toThrow();
    expect(() => signPreviewToken(EID, "", NOW)).toThrow();
    expect(() => signPreviewToken(EID, SECRET, NOW, 0)).toThrow();
    expect(() => signPreviewToken(EID, SECRET, NOW, PREVIEW_TOKEN_TTL_SEC + 1)).toThrow();
  });
});
