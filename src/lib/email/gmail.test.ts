import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { sendEmail, isEmailConfigured, buildMessage, encodeHeader, resetTokenCache, EmailError } from "./gmail";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY = {
  client_email: "rosably-mailer@test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
const keyB64 = Buffer.from(JSON.stringify(KEY)).toString("base64");

const fetchMock = vi.fn();

function okToken() {
  return new Response(JSON.stringify({ access_token: "tok-1", expires_in: 3600 }), { status: 200 });
}
function okSend(id = "msg-1") {
  return new Response(JSON.stringify({ id }), { status: 200 });
}
const decodeRaw = (call: unknown[]) =>
  Buffer.from(JSON.parse((call[1] as RequestInit).body as string).raw, "base64url").toString("utf8");

beforeEach(() => {
  vi.stubEnv("GOOGLE_MAILER_SA_KEY_B64", keyB64);
  vi.stubEnv("GMAIL_SENDER", "brian@rosably.com");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  resetTokenCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("configuration", () => {
  it("is configured with a valid key and the allowed sender", () => {
    expect(isEmailConfigured()).toBe(true);
  });
  it("refuses a sender outside the allowlist without calling Google", async () => {
    vi.stubEnv("GMAIL_SENDER", "someone@rosably.com");
    expect(isEmailConfigured()).toBe(false);
    await expect(sendEmail({ to: "a@b.org", subject: "s", text: "t" })).rejects.toMatchObject({ code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("is not configured when env vars are missing or the key is garbage", () => {
    vi.stubEnv("GOOGLE_MAILER_SA_KEY_B64", "");
    expect(isEmailConfigured()).toBe(false);
    vi.stubEnv("GOOGLE_MAILER_SA_KEY_B64", Buffer.from("not json").toString("base64"));
    expect(isEmailConfigured()).toBe(false);
  });
});

describe("sendEmail", () => {
  it("exchanges a correctly signed delegated JWT, then sends as the sender", async () => {
    fetchMock.mockResolvedValueOnce(okToken()).mockResolvedValueOnce(okSend("abc"));
    await expect(sendEmail({ to: "pat@example.org", subject: "Hello", text: "Body" })).resolves.toEqual({ id: "abc" });

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(tokenInit.body as URLSearchParams);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [h, c, sig] = form.get("assertion")!.split(".");
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(claims).toMatchObject({
      iss: KEY.client_email, sub: "brian@rosably.com",
      scope: "https://www.googleapis.com/auth/gmail.send", aud: "https://oauth2.googleapis.com/token",
    });
    expect(claims.exp - claims.iat).toBe(3600);
    expect(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, sig, "base64url")).toBe(true);

    const [sendUrl, sendInit] = fetchMock.mock.calls[1];
    expect(sendUrl).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect((sendInit.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
    const raw = decodeRaw(fetchMock.mock.calls[1]);
    expect(raw).toContain("From: brian@rosably.com\r\n");
    expect(raw).toContain("To: pat@example.org\r\n");
  });

  it("caches the token across sends", async () => {
    fetchMock.mockResolvedValueOnce(okToken()).mockResolvedValueOnce(okSend()).mockResolvedValueOnce(okSend("m2"));
    await sendEmail({ to: "a@b.org", subject: "1", text: "t" });
    await sendEmail({ to: "a@b.org", subject: "2", text: "t" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("surfaces token and send failures as typed errors", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "unauthorized_client" }), { status: 401 }));
    const err = await sendEmail({ to: "a@b.org", subject: "s", text: "t" }).catch(e => e);
    expect(err).toBeInstanceOf(EmailError);
    expect(err).toMatchObject({ code: "auth_failed", status: 401 });

    fetchMock.mockResolvedValueOnce(okToken())
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Invalid To header" } }), { status: 400 }));
    await expect(sendEmail({ to: "a@b.org", subject: "s", text: "t" })).rejects.toMatchObject({ code: "send_failed", status: 400 });
  });

  it("rejects bad input before any network call", async () => {
    for (const input of [
      { to: "not-an-email", subject: "s", text: "t" },
      { to: "a@b.org, c@d.org", subject: "s", text: "t" },
      { to: "a@b.org\r\nBcc: x@y.org", subject: "s", text: "t" },
      { to: "a@b.org", subject: "hi\r\nBcc: x@y.org", text: "t" },
      { to: "a@b.org", subject: "s", text: "t", fromName: "Brian\nBcc: x@y.org" },
      { to: "a@b.org", subject: "s", text: "t", replyTo: "bad" },
      { to: "a@b.org", subject: "  ", text: "t" },
    ]) {
      await expect(sendEmail(input)).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("buildMessage", () => {
  it("encodes non-ASCII subject and display name, and base64-encodes the body", () => {
    const raw = buildMessage({ to: "a@b.org", subject: "Café — ready", text: "Héllo\nthere", fromName: "Brian Rosenfélt" }, "brian@rosably.com");
    expect(raw).toContain(`Subject: ${encodeHeader("Café — ready")}\r\n`);
    expect(raw).toMatch(/^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <brian@rosably\.com>\r\n/);
    const body = raw.split("\r\n\r\n")[1];
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("Héllo\r\nthere");
  });
  it("quotes ASCII display names", () => {
    const raw = buildMessage({ to: "a@b.org", subject: "s", text: "t", fromName: 'Brian "B" R' }, "brian@rosably.com");
    expect(raw).toContain('From: "Brian \\"B\\" R" <brian@rosably.com>\r\n');
  });
  it("builds multipart/alternative when html is given", () => {
    const raw = buildMessage({ to: "a@b.org", subject: "s", text: "plain", html: "<p>rich</p>" }, "brian@rosably.com");
    const boundary = raw.match(/boundary="([^"]+)"/)![1];
    expect(raw).toContain("Content-Type: multipart/alternative");
    expect(raw.split(`--${boundary}`)).toHaveLength(4);
    expect(raw).toContain("Content-Type: text/html; charset=UTF-8");
    expect(raw.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
  });
});
