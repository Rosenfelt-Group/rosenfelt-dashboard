import { EmailError } from "./gmail";
import { postmarkServerToken } from "./postmark";

// Server-only. Read/admin calls against Postmark's server API (stats, suppressions, message search)
// for the Email health view. Uses the same POSTMARK_SERVER_TOKEN as sending.
const BASE = "https://api.postmarkapp.com";
const STREAM = "outbound";

export type Suppression = {
  email: string;
  reason: "HardBounce" | "SpamComplaint" | "ManualSuppression";
  origin: string;
  createdAt: string;
};

export type MessageSummary = {
  id: string;
  to: string;
  subject: string;
  tag?: string;
  status: string;
  receivedAt: string;
};

export type MessageDetail = {
  id: string;
  to: string;
  subject: string;
  tag?: string;
  metadata: Record<string, string>;
  textBody?: string;
  htmlBody?: string;
  hasAttachments: boolean;
  events: { type: string; at: string; detail?: string }[];
};

async function pm<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const token = postmarkServerToken();
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      accept: "application/json",
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      "x-postmark-server-token": token,
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throw new EmailError("auth_failed", "Postmark rejected the server token", 401);
  if (!res.ok) {
    const detail = body.Message ? `${body.ErrorCode}: ${body.Message}` : String(res.status);
    throw new EmailError("send_failed", `Postmark request failed: ${detail}`, res.status);
  }
  return body as T;
}

export async function getOutboundStats(
  from: string, to: string, tag?: string,
): Promise<{ sent: number; bounced: number; spamComplaints: number }> {
  const q = new URLSearchParams({ messagestream: STREAM, fromdate: from, todate: to });
  if (tag) q.set("tag", tag);
  const r = await pm<{ Sent?: number; Bounced?: number; SpamComplaints?: number }>(`/stats/outbound?${q}`);
  return { sent: r.Sent ?? 0, bounced: r.Bounced ?? 0, spamComplaints: r.SpamComplaints ?? 0 };
}

export async function listSuppressions(): Promise<Suppression[]> {
  const r = await pm<{ Suppressions?: { EmailAddress: string; SuppressionReason: Suppression["reason"]; Origin: string; CreatedAt: string }[] }>(
    `/message-streams/${STREAM}/suppressions/dump`,
  );
  return (r.Suppressions ?? []).map((s) => ({
    email: s.EmailAddress, reason: s.SuppressionReason, origin: s.Origin, createdAt: s.CreatedAt,
  }));
}

async function changeSuppression(path: string, email: string, ok: "Suppressed" | "Deleted"): Promise<void> {
  const r = await pm<{ Suppressions?: { Status?: string; Message?: string | null }[] }>(
    `/message-streams/${STREAM}/suppressions${path}`,
    { method: "POST", body: { Suppressions: [{ EmailAddress: email }] } },
  );
  const item = r.Suppressions?.[0];
  if (item?.Status !== ok) {
    throw new EmailError("send_failed", `Postmark suppression change failed: ${item?.Message ?? item?.Status ?? "no result"}`);
  }
}

export const suppress = (email: string) => changeSuppression("", email, "Suppressed");
export const unsuppress = (email: string) => changeSuppression("/delete", email, "Deleted");

export async function searchMessages(recipient: string, count = 25): Promise<MessageSummary[]> {
  const q = new URLSearchParams({ recipient, count: String(count), offset: "0" });
  const r = await pm<{ Messages?: { MessageID: string; To?: { Email: string }[]; Subject?: string; Tag?: string | null; Status?: string; ReceivedAt: string }[] }>(
    `/messages/outbound?${q}`,
  );
  return (r.Messages ?? []).map((m) => ({
    id: m.MessageID, to: m.To?.[0]?.Email ?? "", subject: m.Subject ?? "",
    ...(m.Tag ? { tag: m.Tag } : {}), status: m.Status ?? "", receivedAt: m.ReceivedAt,
  }));
}

export async function getMessage(id: string): Promise<MessageDetail> {
  const m = await pm<{
    MessageID: string; To?: { Email: string }[]; Subject?: string; Tag?: string | null;
    Metadata?: Record<string, string> | null; TextBody?: string; HtmlBody?: string; Attachments?: unknown[];
    MessageEvents?: { Type: string; ReceivedAt: string; Details?: { Summary?: string } }[];
  }>(`/messages/outbound/${encodeURIComponent(id)}/details`);
  return {
    id: m.MessageID, to: m.To?.[0]?.Email ?? "", subject: m.Subject ?? "",
    ...(m.Tag ? { tag: m.Tag } : {}),
    metadata: m.Metadata ?? {},
    ...(m.TextBody ? { textBody: m.TextBody } : {}),
    ...(m.HtmlBody ? { htmlBody: m.HtmlBody } : {}),
    hasAttachments: (m.Attachments?.length ?? 0) > 0,
    events: (m.MessageEvents ?? []).map((e) => ({
      type: e.Type, at: e.ReceivedAt, ...(e.Details?.Summary ? { detail: e.Details.Summary } : {}),
    })),
  };
}
