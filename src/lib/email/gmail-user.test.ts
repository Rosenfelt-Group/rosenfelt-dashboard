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
    expect(raw).toContain(`Subject:\r\n =?UTF-8?B?${Buffer.from("Café ☕").toString("base64")}?=\r\n`);
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

describe("address and subject encoding", () => {
  const base = { from: "b@rosably.com", to: ["a@x.org"], cc: [], subject: "S", text: "T" };
  const unfold = (raw: string) => raw.split("\r\n\r\n")[0].replace(/\r\n /g, " ");

  it("encodes_non_ascii_display_name", () => {
    const raw = buildRfc822({ ...base, to: [{ name: "José Ñandú", email: "j@x.org" }] });
    const to = unfold(raw).split("\r\n").find((l) => l.startsWith("To:"))!;
    const m = /=\?UTF-8\?B\?([^?]+)\?= <j@x\.org>/.exec(to);
    expect(m).toBeTruthy();
    expect(Buffer.from(m![1], "base64").toString("utf8")).toBe("José Ñandú");
    expect(raw.split("\r\n\r\n")[0]).toMatch(/^[\x20-\x7e\r\n]*$/);
  });

  it("quotes_display_name_with_comma", () => {
    const raw = buildRfc822({ ...base, to: [{ name: "Smith, Jo \"JJ\"", email: "j@x.org" }, { name: "Dr. Who", email: "w@x.org" }, { name: "Plain Name", email: "p@x.org" }] });
    expect(raw).toContain('To: "Smith, Jo \\"JJ\\"" <j@x.org>, "Dr. Who" <w@x.org>, Plain Name <p@x.org>');
  });

  it("rejects bad structured emails", () => {
    for (const email of ["a@x.org\r\nBcc: e@x.org", "a<b@x.org", "a@x.org>", "a@x.org,b@x.org"]) {
      expect(() => buildRfc822({ ...base, to: [{ email }] })).toThrow();
    }
    expect(() => buildRfc822({ ...base, to: [{ name: "N\nBcc: e", email: "a@x.org" }] })).toThrow();
  });

  it("folds_long_ascii_subject", () => {
    const subject = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const head = buildRfc822({ ...base, subject }).split("\r\n\r\n")[0];
    for (const line of head.split("\r\n")) expect(line.length).toBeLessThanOrEqual(78);
    expect(head).toMatch(/\r\n word\d+/);
    expect(unfold(buildRfc822({ ...base, subject }))).toContain(`Subject: ${subject}`);
  });

  it("splits_long_non_ascii_subject_into_encoded_words", () => {
    const subject = "Réunion équipe ☕ ".repeat(12) + "😀😀😀😀😀😀😀😀😀😀😀😀😀😀";
    const head = buildRfc822({ ...base, subject }).split("\r\n\r\n")[0];
    const words = [...head.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)];
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) expect(w[0].length).toBeLessThanOrEqual(75);
    for (const line of head.split("\r\n")) expect(line.length).toBeLessThanOrEqual(78);
    expect(words.map((w) => Buffer.from(w[1], "base64").toString("utf8")).join("")).toBe(subject);
  });
});

describe("message parsing", () => {
  it("decodes_iso_8859_1_part", () => {
    const part = { mimeType: "text/plain", headers: [{ name: "Content-Type", value: 'text/plain; charset="ISO-8859-1"' }], body: { data: Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString("base64url") } };
    expect(extractBody(part)).toBe("café");
  });

  it("decodes_windows_1252_part", () => {
    const part = { mimeType: "text/plain", headers: [{ name: "content-type", value: "text/plain; charset=windows-1252" }], body: { data: Buffer.from([0x80, 0x93, 0x94]).toString("base64url") } };
    expect(extractBody(part)).toBe("\u20ac\u201c\u201d");
  });

  it("falls back to UTF-8 for unknown charset labels", () => {
    const part = { mimeType: "text/plain", headers: [{ name: "Content-Type", value: "text/plain; charset=x-bogus" }], body: { data: b64url("héllo") } };
    expect(extractBody(part)).toBe("héllo");
  });

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

describe("listMessages", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it("lists ids for a query with paging", async () => {
    vi.stubEnv("GMAIL_READ_REFRESH_TOKEN", "rt-read");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "sec");
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 });
      urls.push(url);
      return new Response(JSON.stringify({ messages: [{ id: "a", threadId: "t" }, { id: "b", threadId: "t" }], nextPageToken: "np" }), { status: 200 });
    }));
    const r = await gmailRead().listMessages("newer_than:7d", "pt");
    expect(r).toEqual({ ids: ["a", "b"], nextPageToken: "np" });
    expect(urls[0]).toContain("/messages?");
    expect(urls[0]).toContain("q=newer_than%3A7d");
    expect(urls[0]).toContain("pageToken=pt");
  });
  it("tolerates an empty mailbox result", async () => {
    vi.stubEnv("GMAIL_READ_REFRESH_TOKEN", "rt-read");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "sec");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("oauth2") ? { access_token: "at" } : {}), { status: 200 })));
    expect(await gmailRead().listMessages("x")).toEqual({ ids: [], nextPageToken: undefined });
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
