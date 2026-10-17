import { EmailError, isValidEmail, type SendEmailInput } from "./gmail";

// Server-only. Sends mail through Postmark's HTTP API (server "Rosably_Postmark1", transactional
// stream "outbound"). rosably.com is verified in Postmark (DKIM + Return-Path), so any rosably.com
// address can send; the sender is still pinned here rather than trusted from the environment.
//
// Env: POSTMARK_SERVER_TOKEN and POSTMARK_SENDER.
export const ALLOWED_SENDERS = ["brian@rosably.com"] as const;

const SEND_URL = "https://api.postmarkapp.com/email";
const MESSAGE_STREAM = "outbound";

type Config = { token: string; sender: string };

function loadConfig(): Config {
  const token = process.env.POSTMARK_SERVER_TOKEN?.trim();
  const sender = process.env.POSTMARK_SENDER?.trim().toLowerCase();
  if (!token || !sender) throw new EmailError("not_configured", "Email is not configured");
  if (!(ALLOWED_SENDERS as readonly string[]).includes(sender)) {
    throw new EmailError("not_configured", "POSTMARK_SENDER is not an allowed sender");
  }
  return { token, sender };
}

export function isPostmarkConfigured(): boolean {
  try {
    loadConfig();
    return true;
  } catch {
    return false;
  }
}

function formatFrom(name: string | undefined, addr: string): string {
  // Postmark parses the From header itself and handles non-ASCII names; quote and escape only.
  return name ? `"${name.replace(/["\\]/g, "\\$&")}" <${addr}>` : addr;
}

export function buildPayload(input: SendEmailInput, sender: string) {
  const to = input.to.trim();
  if (!isValidEmail(to)) throw new EmailError("invalid_input", "Invalid recipient address");
  const replyTo = input.replyTo?.trim();
  if (replyTo !== undefined && !isValidEmail(replyTo)) throw new EmailError("invalid_input", "Invalid reply-to address");
  if (!input.subject.trim()) throw new EmailError("invalid_input", "Subject is required");
  if (/[\r\n]/.test(input.subject)) throw new EmailError("invalid_input", "subject must not contain line breaks");
  if (input.fromName !== undefined && /[\r\n]/.test(input.fromName)) {
    throw new EmailError("invalid_input", "fromName must not contain line breaks");
  }
  return {
    From: formatFrom(input.fromName, sender),
    To: to,
    ...(replyTo ? { ReplyTo: replyTo } : {}),
    Subject: input.subject,
    TextBody: input.text,
    ...(input.html !== undefined ? { HtmlBody: input.html } : {}),
    MessageStream: MESSAGE_STREAM,
    TrackOpens: false,
    TrackLinks: "None",
  };
}

export async function sendViaPostmark(input: SendEmailInput): Promise<{ id: string }> {
  const config = loadConfig();
  const payload = buildPayload(input, config.sender);
  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-postmark-server-token": config.token,
    },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as { MessageID?: string; ErrorCode?: number; Message?: string };
  if (res.status === 401) throw new EmailError("auth_failed", "Postmark rejected the server token", 401);
  if (!res.ok || body.ErrorCode !== 0 || !body.MessageID) {
    const detail = body.Message ? `${body.ErrorCode}: ${body.Message}` : String(res.status);
    throw new EmailError("send_failed", `Postmark send failed: ${detail}`, res.status);
  }
  return { id: body.MessageID };
}
