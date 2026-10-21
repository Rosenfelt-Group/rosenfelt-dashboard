import { describe, it, expect, vi, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { buildRfc822, extractBody, parseMessage, gmailRead, gmailSend } from "./gmail-user";

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("buildRfc822", () => {
  const base = { from: "Brian <brian@rosably.com>", to: ["a@x.org"], cc: [], subject: "Hello", text: "Hi there" };

  it("buildRfc822_threads_reply", () => {
    const raw = buildRfc822({ ...base, subject: "Re: Hello", inReplyTo: "<abc@mail.x.org>", references: "<root@x.org> <abc@mail.x.org>" });
    expect(raw).toContain("In-Reply-To: <abc@mail.x.org>\r\n");
    expect(raw).toContain("References: <root@x.org> <abc@mail.x.org>\r\n");
    expect(raw).toContain("Subject: Re: Hello\r\n");
  });

  it("buildRfc822_rejects_header_injection", () => {
    expect(() => buildRfc822({ ...base, subject: "Hi\r\nBcc: evil@x.org" })).toThrow(/header/i);
    expect(() => buildRfc822({ ...base, subject: "Hi\nBcc: evil@x.org" })).toThrow();
    expect(() => buildRfc822({ ...base, to: ["a@x.org\r\nBcc: e@x.org"] })).toThrow();
    expect(() => buildRfc822({ ...base, cc: ["c@x.org\n"] })).toThrow();
    expect(() => buildRfc822({ ...base, from: "B\r\n<b@x.org>" })).toThrow();
    expect(() => buildRfc822({ ...base, inReplyTo: "<a>\r\nX: y" })).toThrow();
    expect(() => buildRfc822({ ...base, references: "<a>\nX: y" })).toThrow();
  });

  it("encodes UTF-8 subjects, plain text body, and omits empty Cc", () => {
    const raw = buildRfc822({ ...base, subject: "Café ☕" });
    expect(raw).toContain(`Subject: =?UTF-8?B?${Buffer.from("Café ☕").toString("base64")}?=\r\n`);
    expect(raw).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(raw).toContain("MIME-Version: 1.0");
    expect(raw).not.toMatch(/^Cc:/m);
    expect(raw.split("\r\n\r\n")[1]).toBeTruthy();
    const withCc = buildRfc822({ ...base, cc: ["c@x.org", "d@x.org"] });
    expect(withCc).toContain("Cc: c@x.org, d@x.org\r\n");
  });

  it("keeps ASCII subjects readable and allows newlines in the body", () => {
    const raw = buildRfc822({ ...base, text: "line1\nline2" });
    expect(raw).toContain("Subject: Hello\r\n");
    const body = Buffer.from(raw.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
    expect(body).toBe("line1\r\nline2");
  });
});

describe("message parsing", () => {
  it("prefers text/plain over html in multipart/alternative", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/html", body: { data: b64url("<p>html</p>") } },
        { mimeType: "text/plain", body: { data: b64url("plain body") } },
      ],
    };
    expect(extractBody(payload)).toBe("plain body");
  });

  it("falls back to stripped html", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/html", body: { data: b64url("<style>x{}</style><p>Hello&nbsp;<b>world</b> &amp; co</p><br>next") } },
        { mimeType: "application/pdf", filename: "a.pdf", body: { attachmentId: "x" } },
      ],
    };
    expect(extractBody(payload)).toBe("Hello world & co\nnext");
  });

  it("parseMessage builds a typed GmailMessage with lowercase headers", () => {
    const m = parseMessage({
      id: "m1", threadId: "t1", labelIds: ["INBOX"], internalDate: "1700000000000", snippet: "s",
      payload: { mimeType: "text/plain", headers: [{ name: "Subject", value: "Yo" }, { name: "Message-ID", value: "<m@x>" }], body: { data: b64url("body") } },
    });
    expect(m).toMatchObject({ id: "m1", threadId: "t1", labelIds: ["INBOX"], internalDate: 1700000000000, bodyText: "body" });
    expect(m.headers["subject"]).toBe("Yo");
    expect(m.headers["message-id"]).toBe("<m@x>");
  });
});

describe("clients", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("does not touch env at import or construction-free; fails clearly at call time", () => {
    vi.stubEnv("GMAIL_READ_REFRESH_TOKEN", "");
    expect(() => gmailRead()).toThrow(/GMAIL_READ_REFRESH_TOKEN/);
    vi.stubEnv("GMAIL_SEND_REFRESH_TOKEN", "");
    expect(() => gmailSend()).toThrow(/GMAIL_SEND_REFRESH_TOKEN/);
  });

  it("send exchanges its own refresh token and posts base64url raw", async () => {
    vi.stubEnv("GMAIL_SEND_REFRESH_TOKEN", "rt-send");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "sec");
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ id: "gid", threadId: "tid" }), { status: 200 });
    }));
    const raw = buildRfc822({ from: "b@rosably.com", to: ["a@x.org"], cc: [], subject: "S", text: "T" });
    const res = await gmailSend().send(raw);
    expect(res).toEqual({ id: "gid", threadId: "tid" });
    expect(String(calls[0].init?.body)).toContain("refresh_token=rt-send");
    expect(calls[1].url).toContain("/messages/send");
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe("Bearer at");
    expect(JSON.parse(String(calls[1].init?.body)).raw).toBe(Buffer.from(raw).toString("base64url"));
  });

  it("getHistory maps pages and tolerates empty history", async () => {
    vi.stubEnv("GMAIL_READ_REFRESH_TOKEN", "rt-read");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "sec");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ historyId: "99", history: [{ messagesAdded: [{ message: { id: "a" } }, { message: { id: "b" } }] }, { messagesAdded: [{ message: { id: "a" } }] }] }), { status: 200 });
    }));
    const page = await gmailRead().getHistory("10");
    expect(page).toEqual({ historyId: "99", nextPageToken: undefined, addedMessageIds: ["a", "b"] });
  });
});

describe("static import guard", () => {
  it("only_executor_imports_gmailSend", () => {
    const root = path.resolve(__dirname, "../..");
    const allowed = new Set([path.join(root, "lib/email/executor.ts"), path.join(root, "lib/email/gmail-user.test.ts"), path.join(root, "lib/email/gmail-user.ts")]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx|js|jsx|mjs)$/.test(name) || allowed.has(p)) continue;
        if (/\bgmailSend\b/.test(readFileSync(p, "utf8"))) offenders.push(path.relative(root, p));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
