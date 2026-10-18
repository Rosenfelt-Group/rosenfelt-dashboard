import { createSign, randomBytes } from "node:crypto";

// Server-only. Sends mail through the Gmail API as a Workspace user, using the rosably-mailer
// service account's domain-wide delegation (scope gmail.send only). Never import from client code.
//
// Env: GOOGLE_MAILER_SA_KEY_B64 (base64 of the service account JSON key) and GMAIL_SENDER.
// Delegation lets the service account act as ANY rosably.com user, so the sender is pinned to an
// allowlist here rather than trusted from the environment.
export const ALLOWED_SENDERS = ["brian@rosably.com"] as const;

const SCOPE = "https://www.googleapis.com/auth/gmail.send";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export type EmailErrorCode = "not_configured" | "invalid_input" | "auth_failed" | "send_failed";

export class EmailError extends Error {
  constructor(public code: EmailErrorCode, message: string, public status?: number) {
    super(message);
    this.name = "EmailError";
  }
}

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  fromName?: string;
  // Postmark-only: tag and metadata make a send attributable in bounce/spam alerts. Gmail ignores them.
  tag?: string;
  metadata?: Record<string, string>;
};

type ServiceAccountKey = { client_email: string; private_key: string };
type Config = { key: ServiceAccountKey; sender: string };

// Deliberately strict: one plain address, no display names, no lists.
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function isValidEmail(addr: string): boolean {
  return addr.length <= 254 && EMAIL_RE.test(addr);
}

function loadConfig(): Config {
  const b64 = process.env.GOOGLE_MAILER_SA_KEY_B64;
  const sender = process.env.GMAIL_SENDER?.trim().toLowerCase();
  if (!b64 || !sender) throw new EmailError("not_configured", "Email is not configured");
  if (!(ALLOWED_SENDERS as readonly string[]).includes(sender)) {
    throw new EmailError("not_configured", "GMAIL_SENDER is not an allowed sender");
  }
  let key: ServiceAccountKey;
  try {
    key = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    throw new EmailError("not_configured", "GOOGLE_MAILER_SA_KEY_B64 is not valid base64 JSON");
  }
  if (!key?.client_email || !key?.private_key) {
    throw new EmailError("not_configured", "Service account key is missing client_email or private_key");
  }
  return { key, sender };
}

export function isEmailConfigured(): boolean {
  try {
    loadConfig();
    return true;
  } catch {
    return false;
  }
}

let cachedToken: { cacheKey: string; token: string; expiresAt: number } | null = null;

// For tests.
export function resetTokenCache() {
  cachedToken = null;
}

async function accessToken({ key, sender }: Config): Promise<string> {
  const cacheKey = `${key.client_email}|${sender}`;
  if (cachedToken && cachedToken.cacheKey === cacheKey && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.token;
  }
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: key.client_email, sub: sender, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  })}`;
  let sig: string;
  try {
    sig = createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url");
  } catch {
    throw new EmailError("not_configured", "Service account private key could not sign");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${sig}`,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) {
    throw new EmailError("auth_failed", `Google token exchange failed: ${body.error ?? res.status}`, res.status);
  }
  cachedToken = { cacheKey, token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}

function assertHeaderSafe(name: string, value: string) {
  if (/[\r\n]/.test(value)) throw new EmailError("invalid_input", `${name} must not contain line breaks`);
}

// RFC 2047 encoded-word for non-ASCII header text; ASCII passes through.
export function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function formatFrom(name: string | undefined, addr: string): string {
  if (!name) return addr;
  // ASCII names are quoted (escaping " and \); non-ASCII names are encoded-words, which can't be quoted.
  const display = /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, "\\$&")}"` : encodeHeader(name);
  return `${display} <${addr}>`;
}

// Base64 body wrapped at 76 columns, so any UTF-8 text is transported safely.
function b64Body(s: string): string {
  return Buffer.from(s.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}(?=.)/g, "$&\r\n");
}

export function buildMessage(input: SendEmailInput, sender: string): string {
  const to = input.to.trim();
  if (!isValidEmail(to)) throw new EmailError("invalid_input", "Invalid recipient address");
  if (input.replyTo !== undefined && !isValidEmail(input.replyTo.trim())) {
    throw new EmailError("invalid_input", "Invalid reply-to address");
  }
  if (!input.subject.trim()) throw new EmailError("invalid_input", "Subject is required");
  assertHeaderSafe("subject", input.subject);
  if (input.fromName !== undefined) assertHeaderSafe("fromName", input.fromName);

  const headers = [
    `From: ${formatFrom(input.fromName, sender)}`,
    `To: ${to}`,
    ...(input.replyTo ? [`Reply-To: ${input.replyTo.trim()}`] : []),
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
  ];
  const textPart = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64Body(input.text)];

  if (input.html === undefined) return [...headers, ...textPart].join("\r\n");

  const boundary = `=_rosably_${randomBytes(12).toString("hex")}`;
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...textPart,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Body(input.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const config = loadConfig();
  const raw = buildMessage(input, config.sender);
  const token = await accessToken(config);
  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw: Buffer.from(raw, "utf8").toString("base64url") }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (res.status === 401) cachedToken = null;
  if (!res.ok || !body.id) {
    throw new EmailError("send_failed", `Gmail send failed: ${body.error?.message ?? res.status}`, res.status);
  }
  return { id: body.id };
}
