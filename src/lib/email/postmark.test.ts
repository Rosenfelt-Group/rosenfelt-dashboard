import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendViaPostmark, isPostmarkConfigured, buildPayload } from "./postmark";
import { sendEmail, emailProvider, isEmailConfigured, EmailError } from "./index";

const fetchMock = vi.fn();
const okSend = (id = "pm-1") => new Response(JSON.stringify({ ErrorCode: 0, Message: "OK", MessageID: id }), { status: 200 });
const sentBody = (i = 0) => JSON.parse((fetchMock.mock.calls[i][1] as RequestInit).body as string);

beforeEach(() => {
  vi.stubEnv("POSTMARK_SERVER_TOKEN", "pm-token");
  vi.stubEnv("POSTMARK_SENDER", "brian@rosably.com");
  vi.stubEnv("GOOGLE_MAILER_SA_KEY_B64", "");
  vi.stubEnv("GMAIL_SENDER", "");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("postmark config", () => {
  it("needs both token and sender", () => {
    expect(isPostmarkConfigured()).toBe(true);
    vi.stubEnv("POSTMARK_SERVER_TOKEN", "");
    expect(isPostmarkConfigured()).toBe(false);
  });

  it("refuses a sender outside the allowlist", async () => {
    vi.stubEnv("POSTMARK_SENDER", "someone@rosably.com");
    expect(isPostmarkConfigured()).toBe(false);
    await expect(sendViaPostmark({ to: "a@b.co", subject: "s", text: "t" })).rejects.toMatchObject({ code: "not_configured" });
  });
});

describe("buildPayload", () => {
  it("builds a transactional message with tracking off", () => {
    const p = buildPayload({ to: " a@b.co ", subject: "Hi", text: "plain", html: "<p>x</p>", replyTo: "r@b.co", fromName: 'Brian "B"' }, "brian@rosably.com");
    expect(p).toEqual({
      From: '"Brian \\"B\\"" <brian@rosably.com>', To: "a@b.co", ReplyTo: "r@b.co", Subject: "Hi",
      TextBody: "plain", HtmlBody: "<p>x</p>", MessageStream: "outbound", TrackOpens: false, TrackLinks: "None",
    });
  });

  it("passes Tag and Metadata through", () => {
    const base = { to: "a@b.co", subject: "s", text: "t" };
    const p = buildPayload({ ...base, tag: "t", metadata: { a: "1" } }, "brian@rosably.com");
    expect(p).toMatchObject({ Tag: "t", Metadata: { a: "1" } });
    const q = buildPayload(base, "brian@rosably.com");
    expect(q).not.toHaveProperty("Tag");
    expect(q).not.toHaveProperty("Metadata");
  });

  it("rejects bad input", () => {
    const base = { to: "a@b.co", subject: "s", text: "t" };
    expect(() => buildPayload({ ...base, to: "a@b.co, c@d.co" }, "x@y.co")).toThrow(EmailError);
    expect(() => buildPayload({ ...base, subject: "a\r\nBcc: x@y.co" }, "x@y.co")).toThrow(/line breaks/);
    expect(() => buildPayload({ ...base, replyTo: "nope" }, "x@y.co")).toThrow(/reply-to/);
    expect(() => buildPayload({ ...base, subject: " " }, "x@y.co")).toThrow(/Subject/);
  });
});

describe("sendViaPostmark", () => {
  it("sends with the server token and returns the message id", async () => {
    fetchMock.mockResolvedValueOnce(okSend("pm-42"));
    await expect(sendViaPostmark({ to: "a@b.co", subject: "s", text: "t" })).resolves.toEqual({ id: "pm-42" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.postmarkapp.com/email");
    expect((init as RequestInit).headers).toMatchObject({ "x-postmark-server-token": "pm-token" });
    expect(sentBody().From).toBe("brian@rosably.com");
  });

  it("maps a 401 to auth_failed and API errors to send_failed", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ErrorCode: 10, Message: "Bad token" }), { status: 401 }));
    await expect(sendViaPostmark({ to: "a@b.co", subject: "s", text: "t" })).rejects.toMatchObject({ code: "auth_failed" });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ErrorCode: 406, Message: "Inactive recipient" }), { status: 422 }));
    await expect(sendViaPostmark({ to: "a@b.co", subject: "s", text: "t" })).rejects.toThrow("Postmark send failed: 406: Inactive recipient");
  });
});

describe("provider selection", () => {
  it("prefers Postmark, and reports unconfigured when neither is set", async () => {
    expect(emailProvider()).toBe("postmark");
    fetchMock.mockResolvedValueOnce(okSend());
    await sendEmail({ to: "a@b.co", subject: "s", text: "t" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.postmarkapp.com/email");

    vi.stubEnv("POSTMARK_SERVER_TOKEN", "");
    expect(emailProvider()).toBeNull();
    expect(isEmailConfigured()).toBe(false);
  });
});
