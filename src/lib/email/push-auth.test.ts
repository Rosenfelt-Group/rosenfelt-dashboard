import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { SignJWT, generateKeyPair, createLocalJWKSet, exportJWK } from "jose";
import { verifyPushToken } from "./push-auth";

let priv: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  priv = kp.privateKey as CryptoKey;
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256", use: "sig" }] });
});
afterEach(() => vi.unstubAllEnvs());

const sign = (c: Record<string, unknown> = {}, o: { iss?: string; aud?: string } = {}) =>
  new SignJWT({ email: "sa@proj.iam.gserviceaccount.com", email_verified: true, ...c })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(o.iss ?? "https://accounts.google.com")
    .setAudience(o.aud ?? "https://d.example/api/email/gmail-push")
    .setExpirationTime("5m")
    .sign(priv);

const env = () => {
  vi.stubEnv("GMAIL_PUSH_AUDIENCE", "https://d.example/api/email/gmail-push");
  vi.stubEnv("GMAIL_PUSH_SA_EMAIL", "sa@proj.iam.gserviceaccount.com");
};

describe("verifyPushToken", () => {
  it("accepts a valid token (both issuer forms)", async () => {
    env();
    expect(await verifyPushToken(await sign(), { jwks })).toBe(true);
    expect(await verifyPushToken(await sign({}, { iss: "accounts.google.com" }), { jwks })).toBe(true);
  });
  it("fails closed when env unset", async () => {
    expect(await verifyPushToken(await sign(), { jwks })).toBe(false);
  });
  it("rejects wrong audience, email, issuer, unverified email, garbage", async () => {
    env();
    expect(await verifyPushToken(await sign({}, { aud: "other" }), { jwks })).toBe(false);
    expect(await verifyPushToken(await sign({ email: "evil@x.org" }), { jwks })).toBe(false);
    expect(await verifyPushToken(await sign({}, { iss: "https://evil.example" }), { jwks })).toBe(false);
    expect(await verifyPushToken(await sign({ email_verified: false }), { jwks })).toBe(false);
    expect(await verifyPushToken("garbage", { jwks })).toBe(false);
  });
  it("rejects a token signed by another key", async () => {
    env();
    const other = await generateKeyPair("RS256");
    const t = await new SignJWT({ email: "sa@proj.iam.gserviceaccount.com", email_verified: true })
      .setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer("https://accounts.google.com")
      .setAudience("https://d.example/api/email/gmail-push").setExpirationTime("5m").sign(other.privateKey);
    expect(await verifyPushToken(t, { jwks })).toBe(false);
  });
});
