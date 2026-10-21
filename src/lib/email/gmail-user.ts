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

export type Rfc822Input = {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string;
};

function safeHeader(name: string, value: string): string {
  if (/[\r\n]/.test(value)) throw new GmailUserError("invalid_input", `CR/LF not allowed in header value: ${name}`);
  return value;
}

function encodeSubject(subject: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

export function buildRfc822(input: Rfc822Input): RfcMessage {
  const headers: string[] = [
    `From: ${safeHeader("From", input.from)}`,
    `To: ${input.to.map((a) => safeHeader("To", a)).join(", ")}`,
  ];
  if (input.cc.length) headers.push(`Cc: ${input.cc.map((a) => safeHeader("Cc", a)).join(", ")}`);
  headers.push(`Subject: ${encodeSubject(safeHeader("Subject", input.subject))}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${safeHeader("In-Reply-To", input.inReplyTo)}`);
  if (input.references) headers.push(`References: ${safeHeader("References", input.references)}`);
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

const decodePart = (p: Part) => (p.body?.data ? Buffer.from(p.body.data, "base64url").toString("utf8") : "");

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
      const j = await call<{ historyId: string; nextPageToken?: string; history?: { messagesAdded?: { message: { id: string } }[] }[] }>(getToken, `/history?${q}`);
      const ids = new Set<string>();
      for (const h of j.history ?? []) for (const a of h.messagesAdded ?? []) ids.add(a.message.id);
      return { historyId: j.historyId, nextPageToken: j.nextPageToken, addedMessageIds: [...ids] };
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
    async send(raw: RfcMessage): Promise<{ id: string; threadId: string }> {
      const j = await call<{ id: string; threadId: string }>(getToken, "/messages/send", {
        method: "POST",
        body: { raw: Buffer.from(raw, "utf8").toString("base64url") },
      });
      return { id: j.id, threadId: j.threadId };
    },
  };
}
