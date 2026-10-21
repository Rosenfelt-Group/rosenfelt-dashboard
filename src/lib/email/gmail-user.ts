// Server-only. Gmail client acting as brian@rosably.com via per-user OAuth refresh tokens
// (not the domain-wide-delegation service account in gmail.ts, which is retired in Task 17).
//
// Two clients with separate least-privilege grants:
//   gmailRead()  -> GMAIL_READ_REFRESH_TOKEN (scope gmail.readonly)
//   gmailSend()  -> GMAIL_SEND_REFRESH_TOKEN (scope gmail.send)
// Plus GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET. Env is read at call time, never at import.
//
// Only src/lib/email/executor.ts may import gmailSend (enforced by gmail-user.test.ts).
// Uses plain fetch against the Gmail REST API; no googleapis dependency.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GmailHeaders = Record<string, string>; // lowercase header name -> value (first wins)

export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds: string[];
  /** Epoch milliseconds (Gmail's internalDate). */
  internalDate: number;
  snippet: string;
  headers: GmailHeaders;
  /** Plain text: text/plain part if present, else tags-stripped text/html, else "". */
  bodyText: string;
};

export type HistoryPage = {
  /** Mailbox's current history id as of this page; store it as the next startHistoryId. */
  historyId: string;
  nextPageToken?: string;
  /** Unique ids of messages added (in order of first appearance). */
  addedMessageIds: string[];
  /** History records in the order Gmail returned them (ascending id), each with the message ids it added. */
  records: { id: string; messageIds: string[] }[];
};

/** A complete RFC 5322 message produced by buildRfc822. */
export type RfcMessage = string;

export class GmailUserError extends Error {
  constructor(public code: "not_configured" | "auth_failed" | "api_error" | "invalid_input", message: string, public status?: number) {
    super(message);
    this.name = "GmailUserError";
  }
}

// ---------- RFC 5322 ----------

/** An address: a bare string (used verbatim, CR/LF rejected) or a structured name + email. */
export type MailAddress = string | { name?: string; email: string };

export type Rfc822Input = {
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string;
};

function safeHeader(name: string, value: string): string {
  if (/[\r\n]/.test(value)) throw new GmailUserError("invalid_input", `CR/LF not allowed in header value: ${name}`);
  return value;
}

const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/**
 * RFC 2047 encoded-words (UTF-8, base64), each at most 75 chars, split on code-point boundaries.
 * 75 = 10 ("=?UTF-8?B?") + 2 ("?=") + 63 base64 chars, i.e. at most 45 source bytes per word.
 */
export function encodeWords(text: string): string[] {
  const words: string[] = [];
  let cur: string[] = [];
  let bytes = 0;
  const flush = () => {
    if (cur.length) words.push(`=?UTF-8?B?${Buffer.from(cur.join(""), "utf8").toString("base64")}?=`);
    cur = [];
    bytes = 0;
  };
  for (const ch of text) {
    const n = Buffer.byteLength(ch, "utf8");
    if (bytes + n > 45) flush();
    cur.push(ch);
    bytes += n;
  }
  flush();
  return words;
}

/** Fold an ASCII header at spaces so lines stay within 78 chars (CRLF + space continuation). */
function fold(name: string, value: string): string {
  const lines: string[] = [];
  let line = `${name}:`;
  for (const w of value.split(" ")) {
    if (line.length + 1 + w.length > 78 && line.trim().length > name.length + 1) {
      lines.push(line);
      line = ` ${w}`;
    } else {
      line += line.endsWith(":") ? ` ${w}` : ` ${w}`;
    }
  }
  lines.push(line);
  return lines.join("\r\n");
}

function formatAddress(label: string, a: MailAddress): string {
  if (typeof a === "string") return safeHeader(label, a);
  safeHeader(label, a.email);
  if (/[<>,\s]/.test(a.email) || !a.email) throw new GmailUserError("invalid_input", `Invalid email address in ${label}`);
  if (!a.name) return a.email;
  safeHeader(label, a.name);
  if (!isAscii(a.name)) return `${encodeWords(a.name).join(" ")} <${a.email}>`;
  const display = /[,;:<>@"()\[\]\\.]/.test(a.name) ? `"${a.name.replace(/(["\\])/g, "\\$1")}"` : a.name;
  return `${display} <${a.email}>`;
}

function subjectHeader(subject: string): string {
  safeHeader("Subject", subject);
  if (isAscii(subject)) return fold("Subject", subject);
  return `Subject:${encodeWords(subject).map((w) => `\r\n ${w}`).join("")}`;
}

export function buildRfc822(input: Rfc822Input): RfcMessage {
  const list = (label: string, xs: MailAddress[]) => fold(label, xs.map((a) => formatAddress(label, a)).join(", "));
  const headers: string[] = [fold("From", formatAddress("From", input.from)), list("To", input.to)];
  if (input.cc.length) headers.push(list("Cc", input.cc));
  headers.push(subjectHeader(input.subject));
  if (input.inReplyTo) headers.push(fold("In-Reply-To", safeHeader("In-Reply-To", input.inReplyTo)));
  if (input.references) headers.push(fold("References", safeHeader("References", input.references)));
  headers.push("MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64");
  const body = Buffer.from(input.text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

// ---------- MIME parsing ----------

type Part = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string };
  parts?: Part[];
};

type RawMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  snippet?: string;
  payload?: Part;
};

function partCharset(p: Part): string {
  const ct = p.headers?.find((h) => h.name.toLowerCase() === "content-type")?.value ?? "";
  return /charset\s*=\s*"?([^";\s]+)/i.exec(ct)?.[1] ?? "utf-8";
}

// Node's TextDecoder decodes the windows-1252 label as plain latin1 (0x80-0x9f stay C1 controls).
// Per WHATWG the iso-8859-1/latin1/ascii labels are windows-1252 too, so decode those ourselves.
const CP1252_HIGH = "\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178";
const CP1252_LABELS = new Set(["windows-1252", "cp1252", "x-cp1252", "iso-8859-1", "iso8859-1", "latin1", "l1", "us-ascii", "ascii", "iso_8859-1"]);

function decodeCp1252(bytes: Buffer): string {
  let out = "";
  for (const b of bytes) out += b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b);
  return out;
}

function decodePart(p: Part): string {
  if (!p.body?.data) return "";
  const bytes = Buffer.from(p.body.data, "base64url");
  const charset = partCharset(p);
  if (CP1252_LABELS.has(charset.toLowerCase())) return decodeCp1252(bytes);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes); // unknown charset label
  }
}

function findPart(p: Part, mime: string): string | null {
  if (p.mimeType === mime && !p.filename && p.body?.data) return decodePart(p);
  for (const c of p.parts ?? []) {
    const hit = findPart(c, mime);
    if (hit !== null) return hit;
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const cp = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Plain-text body from a Gmail MIME payload: prefers text/plain, falls back to stripped text/html. */
export function extractBody(payload: Part | undefined): string {
  if (!payload) return "";
  const plain = findPart(payload, "text/plain");
  if (plain !== null) return plain;
  const html = findPart(payload, "text/html");
  return html !== null ? htmlToText(html) : "";
}

export function parseMessage(raw: RawMessage): GmailMessage {
  const headers: GmailHeaders = {};
  for (const h of raw.payload?.headers ?? []) {
    const k = h.name.toLowerCase();
    if (!(k in headers)) headers[k] = h.value;
  }
  return {
    id: raw.id,
    threadId: raw.threadId,
    labelIds: raw.labelIds ?? [],
    internalDate: Number(raw.internalDate ?? 0),
    snippet: raw.snippet ?? "",
    headers,
    bodyText: extractBody(raw.payload),
  };
}

// ---------- HTTP ----------

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new GmailUserError("not_configured", `${name} is not set`);
  return v;
}

function makeAuth(refreshEnv: string) {
  const refreshToken = requireEnv(refreshEnv); // fail at call time, before any network
  let cached: { token: string; exp: number } | null = null;
  return async (): Promise<string> => {
    if (cached && cached.exp > Date.now() + 60_000) return cached.token;
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
        client_secret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!res.ok) throw new GmailUserError("auth_failed", `Token refresh failed (${res.status})`, res.status);
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new GmailUserError("auth_failed", "Token response had no access_token");
    cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return cached.token;
  };
}

async function call<T>(getToken: () => Promise<string>, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) throw new GmailUserError("api_error", `Gmail ${init.method ?? "GET"} ${path.split("?")[0]} failed (${res.status})`, res.status);
  return (await res.json()) as T;
}

export function gmailRead() {
  const getToken = makeAuth("GMAIL_READ_REFRESH_TOKEN");
  return {
    async getHistory(startHistoryId: string, pageToken?: string): Promise<HistoryPage> {
      const q = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded" });
      if (pageToken) q.set("pageToken", pageToken);
      const j = await call<{ historyId: string; nextPageToken?: string; history?: { id: string; messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[] }>(getToken, `/history?${q}`);
      const ids = new Set<string>();
      const records: { id: string; messageIds: string[] }[] = [];
      for (const h of j.history ?? []) {
        const mine = [...new Set((h.messagesAdded ?? []).filter((a) => !a.message.labelIds?.includes("DRAFT")).map((a) => a.message.id))];
        mine.forEach((m) => ids.add(m));
        if (mine.length) records.push({ id: h.id, messageIds: mine });
      }
      return { historyId: j.historyId, nextPageToken: j.nextPageToken, addedMessageIds: [...ids], records };
    },
    async listMessages(q: string, pageToken?: string): Promise<{ ids: string[]; nextPageToken?: string }> {
      const params = new URLSearchParams({ q });
      if (pageToken) params.set("pageToken", pageToken);
      const j = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(getToken, `/messages?${params}`);
      return { ids: (j.messages ?? []).map((m) => m.id), nextPageToken: j.nextPageToken };
    },
    async getMessage(id: string): Promise<GmailMessage> {
      return parseMessage(await call<RawMessage>(getToken, `/messages/${encodeURIComponent(id)}?format=full`));
    },
    async watch(topic: string): Promise<{ historyId: string; expiration: string }> {
      return call(getToken, "/watch", { method: "POST", body: { topicName: topic, labelIds: ["INBOX", "SENT"], labelFilterBehavior: "include" } });
    },
  };
}

export function gmailSend() {
  const getToken = makeAuth("GMAIL_SEND_REFRESH_TOKEN");
  return {
    async send(raw: RfcMessage, opts?: { threadId?: string }): Promise<{ id: string; threadId: string }> {
      const j = await call<{ id: string; threadId: string }>(getToken, "/messages/send", {
        method: "POST",
        body: { raw: Buffer.from(raw, "utf8").toString("base64url"), ...(opts?.threadId ? { threadId: opts.threadId } : {}) },
      });
      return { id: j.id, threadId: j.threadId };
    },
  };
}
