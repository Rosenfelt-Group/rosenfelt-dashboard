// Server-only. Pure classification/matching for Gmail messages plus a store step (applyIngest).
// Message bodies are untrusted data: they are stored and parsed for addresses only, never interpreted.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { after } from "next/server";
import { requestDraftReply } from "@/lib/riley/client";
import type { GmailMessage } from "./gmail-user";

export const BRIAN = "brian@rosably.com";
export const CRM_ADDRESS = "crm@rosably.com";

// ---------- Address parsing (RFC 5322 subset + RFC 2047 names) ----------

export type ParsedAddress = { name: string; email: string };

/** Same normalisation as crm.contacts.email_norm: lower(btrim(email)). */
export function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

function decodeQ(text: string): Buffer {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "_") out.push(0x20);
    else if (c === "=" && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(c.charCodeAt(0) & 0xff);
  }
  return Buffer.from(out);
}

/** Decode RFC 2047 encoded-words to plain text; whitespace between adjacent encoded-words is dropped. */
export function decodeMimeWords(s: string): string {
  const joined = s.replace(/(\?=)\s+(?==\?)/g, "$1");
  return joined.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g, (all, charset: string, enc: string, text: string) => {
    try {
      const bytes = enc.toLowerCase() === "b" ? Buffer.from(text, "base64") : decodeQ(text);
      return new TextDecoder(charset.split("*")[0]).decode(bytes);
    } catch {
      return all;
    }
  });
}

/** Split on commas that are outside quotes, angle brackets and comments. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = 0;
  let paren = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      cur += c;
      if (c === "\\" && i + 1 < s.length) cur += s[++i];
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === "(") paren++;
    else if (c === ")" && paren > 0) paren--;
    else if (paren === 0 && c === "<") angle++;
    else if (paren === 0 && c === ">" && angle > 0) angle--;
    else if (c === "," && angle === 0 && paren === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

function stripComments(s: string): string {
  let out = "";
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      out += c;
      if (c === "\\" && i + 1 < s.length) out += s[++i];
      else if (c === '"') quoted = false;
    } else if (c === '"' && depth === 0) {
      quoted = true;
      out += c;
    } else if (c === "(") depth++;
    else if (c === ")" && depth > 0) depth--;
    else if (depth === 0) out += c;
  }
  return out;
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/\\(.)/g, "$1");
  return t;
}

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+$/;

export function parseAddressList(header: string | undefined | null): ParsedAddress[] {
  if (!header) return [];
  const out: ParsedAddress[] = [];
  for (const raw of splitTopLevel(stripComments(header))) {
    const item = raw.trim().replace(/;$/, "").replace(/^[^"<@:]+:\s*/, "");
    if (!item) continue;
    const angle = item.match(/<([^<>]*)>\s*$/) ?? item.match(/<([^<>]*)>/);
    let email: string;
    let name = "";
    if (angle) {
      email = angle[1].trim().replace(/^mailto:/i, "");
      name = decodeMimeWords(unquote(item.slice(0, angle.index)));
    } else {
      email = unquote(item).replace(/^mailto:/i, "");
    }
    email = normalizeEmail(email.replace(/^<|>$/g, ""));
    if (!EMAIL_RE.test(email)) continue;
    out.push({ name: name.trim(), email });
  }
  return out;
}

// ---------- Classification ----------

export type Direction = "received" | "sent";
export type ForwardedOriginal = { email: string; name: string; to: string[]; cc: string[] };
export type Classification = {
  direction: Direction;
  participants: string[];
  deliveredToCrm: boolean;
  forwardedOriginal?: ForwardedOriginal;
};

const SKIP_LABELS = ["SPAM", "TRASH", "DRAFT"];

function uniq(a: string[]): string[] {
  return [...new Set(a)];
}

function addrs(msg: GmailMessage, ...names: string[]): string[] {
  return names.flatMap((n) => parseAddressList(msg.headers[n]).map((a) => a.email));
}

function isDeliveredToCrm(msg: GmailMessage): boolean {
  return addrs(msg, "to", "cc", "delivered-to", "x-original-to").includes(CRM_ADDRESS);
}

const FW_SUBJECT = /^\s*(?:re:\s*)*fwd?:/i;
const SEPARATOR = /^(?:-{3,}\s*(?:Original Message|Forwarded message)\s*-{3,}|_{10,})$/i;

/** Outlook "[mailto:x@y]" and Gmail "x@y<mailto:x@y>" forms reduced to something parseAddressList accepts. */
function cleanHeaderAddrs(v: string): string {
  return v
    .replace(/\[mailto:([^\]]*)\]/gi, "<$1>")
    .replace(/(@[^\s<>,;]*)\s*<mailto:[^>]*>/gi, "$1")
    .replace(/;/g, ",");
}

/**
 * Parse a forwarded-header block out of a body (Gmail or Outlook style). It is only treated as a forward
 * when the subject starts with Fw:/Fwd: (after optional Re:) or the body has a separator line, so a quoted
 * reply chain in a BCC'd message is not mistaken for a forward.
 */
export function parseForwardedOriginal(body: string, subject = ""): ForwardedOriginal | undefined {
  const lines = body.split(/\r?\n/).map((l) => l.replace(/^[>\s]+/, "").trim());
  const isForward = FW_SUBJECT.test(subject) || lines.some((l) => SEPARATOR.test(l));
  if (!isForward) return undefined;

  const build = (i: number): ForwardedOriginal | undefined => {
    const m = lines[i].match(/^\*?From:\*?\s*(.+)$/i);
    if (!m) return undefined;
    const a = parseAddressList(cleanHeaderAddrs(m[1]))[0];
    if (!a) return undefined;
    const to: string[] = [];
    const cc: string[] = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 10) && lines[j] !== ""; j++) {
      const h = lines[j].match(/^\*?(To|Cc):\*?\s*(.*)$/i);
      if (!h) continue;
      (h[1].toLowerCase() === "to" ? to : cc).push(...parseAddressList(cleanHeaderAddrs(h[2])).map((x) => x.email));
    }
    return { email: a.email, name: a.name, to, cc };
  };

  for (let i = 0; i < lines.length; i++) {
    if (/^-{3,}\s*Forwarded message\s*-{3,}$/i.test(lines[i])) {
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const f = build(j);
        if (f) return f;
      }
    }
  }
  for (let i = 0; i + 1 < lines.length; i++) {
    if (/^\*?Sent:\*?\s/i.test(lines[i + 1])) {
      const f = build(i);
      if (f) return f;
    }
  }
  return undefined;
}

export function classify(msg: GmailMessage, brian = BRIAN): Classification {
  const me = normalizeEmail(brian);
  const from = addrs(msg, "from")[0];
  const direction: Direction = from === me ? "sent" : "received";
  const deliveredToCrm = isDeliveredToCrm(msg);
  const exclude = (list: string[]) => uniq(list.filter((e) => e !== me && !(deliveredToCrm && e === CRM_ADDRESS)));

  if (deliveredToCrm && from === me) {
    const original = parseForwardedOriginal(msg.bodyText, msg.headers["subject"] ?? "");
    if (original && original.email !== me) {
      return { direction: "received", participants: exclude([original.email]), deliveredToCrm, forwardedOriginal: original };
    }
    if (original) {
      // Forward of a message Brian sent: the original's recipients are the candidates.
      const others = exclude([...original.to, ...original.cc]);
      if (others.length) return { direction: "sent", participants: others, deliveredToCrm, forwardedOriginal: original };
    }
    // BCC / no forwarded block: the other recipients are the candidates.
    return { direction: "sent", participants: exclude(addrs(msg, "to", "cc")), deliveredToCrm };
  }
  if (direction === "sent") {
    return { direction, participants: exclude(addrs(msg, "to", "cc")), deliveredToCrm };
  }
  return { direction, participants: exclude([from, ...addrs(msg, "to", "cc")].filter(Boolean) as string[]), deliveredToCrm };
}

// ---------- Planning ----------

export type ContactRef = { contact_id: string; lead_id: string | null; client_id: string | null };
export type IngestPlan =
  | { kind: "log"; links: ContactRef[] }
  | { kind: "unmatched"; email: string; emails: string[]; direction: Direction }
  | { kind: "skip"; reason: string };

export function planIngest(msg: GmailMessage, contactsByEmail: Map<string, ContactRef>, brian = BRIAN): IngestPlan {
  if (msg.labelIds.some((l) => SKIP_LABELS.includes(l.toUpperCase()))) return { kind: "skip", reason: "label" };
  const c = classify(msg, brian);
  const links: ContactRef[] = [];
  const seen = new Set<string>();
  for (const e of c.participants) {
    const ref = contactsByEmail.get(normalizeEmail(e));
    if (ref && !seen.has(ref.contact_id)) {
      seen.add(ref.contact_id);
      links.push(ref);
    }
  }
  if (links.length) return { kind: "log", links };
  if (!c.deliveredToCrm) return { kind: "skip", reason: "no_contact" };
  if (!c.participants.length) return { kind: "skip", reason: "no_candidate" };
  return { kind: "unmatched", email: c.participants[0], emails: c.participants, direction: c.direction };
}

// ---------- Contact lookup (one query per table) ----------

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

export async function loadContactsByEmail(emails: string[]): Promise<Map<string, ContactRef>> {
  const out = new Map<string, ContactRef>();
  const norm = uniq(emails.map(normalizeEmail).filter(Boolean));
  for (const batch of chunk(norm, 50)) await loadBatch(batch, out); // one query per table per batch of 50
  return out;
}

async function loadBatch(norm: string[], out: Map<string, ContactRef>): Promise<void> {
  const db = supabaseAdmin.schema("crm");

  // Deleted (Trash) rows never match: mail from a deleted contact goes to the unmatched queue.
  const { data: contacts, error: cErr } = await db.from("contacts").select("id, email_norm, business_id").in("email_norm", norm).is("deleted_at", null);
  if (cErr) throw new Error(`contacts lookup failed: ${cErr.message}`);
  if (!contacts?.length) return;
  const ids = contacts.map((c) => c.id as string);
  const bizIds = uniq(contacts.map((c) => c.business_id as string | null).filter((b): b is string => !!b));

  const { data: leads, error: lErr } = await db
    .from("leads")
    .select("id, contact_id, stage, created_at")
    .in("contact_id", ids)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (lErr) throw new Error(`leads lookup failed: ${lErr.message}`);

  const filter = [`contact_id.in.(${ids.join(",")})`, bizIds.length ? `business_id.in.(${bizIds.join(",")})` : ""].filter(Boolean).join(",");
  const { data: clients, error: kErr } = await db
    .from("clients")
    .select("id, contact_id, business_id, created_at")
    .or(filter)
    .neq("billing_status", "cancelled")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (kErr) throw new Error(`clients lookup failed: ${kErr.message}`);

  for (const c of contacts) {
    const mine = (leads ?? []).filter((l) => l.contact_id === c.id); // newest first
    const lead = mine.find((l) => l.stage !== "won" && l.stage !== "lost") ?? mine.find((l) => l.stage === "won") ?? null;
    const own = (clients ?? []).find((k) => k.contact_id === c.id);
    const client = own ?? (c.business_id ? (clients ?? []).find((k) => k.business_id === c.business_id) : undefined);
    out.set(c.email_norm as string, { contact_id: c.id as string, lead_id: (lead?.id as string) ?? null, client_id: (client?.id as string) ?? null });
  }
}

// ---------- Store ----------

/**
 * Stores the message, links, activities and unmatched-queue row in one DB transaction
 * (crm.store_ingested_email). Re-delivery and retries are idempotent and repair missing rows.
 */
export async function applyIngest(plan: IngestPlan, msg: GmailMessage, brian = BRIAN): Promise<void> {
  if (plan.kind === "skip") return;
  const c = classify(msg, brian);

  const fromHdr = parseAddressList(msg.headers["from"])[0];
  const sender = c.forwardedOriginal ?? (fromHdr ? { email: fromHdr.email, name: fromHdr.name } : undefined);
  const subject = msg.headers["subject"] ? decodeMimeWords(msg.headers["subject"]) : null;

  const p: Record<string, unknown> = {
    message: {
      gmail_message_id: msg.id,
      thread_id: msg.threadId,
      rfc_message_id: msg.headers["message-id"] ?? null,
      direction: c.direction,
      from_email: sender?.email ?? null,
      from_name: sender?.name || null,
      to_emails: uniq(addrs(msg, "to")),
      cc_emails: uniq(addrs(msg, "cc")),
      subject,
      snippet: msg.snippet,
      body_text: msg.bodyText,
      sent_at: msg.internalDate ? new Date(msg.internalDate).toISOString() : null,
      source: c.deliveredToCrm ? "forward" : "gmail_watch",
      delivered_to_crm: c.deliveredToCrm,
    },
    links: [],
  };
  if (plan.kind === "unmatched") {
    p.unmatched = { direction: plan.direction, contact_emails: plan.emails, subject, snippet: msg.snippet };
  } else {
    p.links = plan.links.map((l) => ({ contact_id: l.contact_id, lead_id: l.lead_id, client_id: l.client_id }));
    p.activity = {
      activity_type: c.direction === "sent" ? "email_sent" : "email_received",
      email_direction: c.direction,
      email_subject: subject,
      content: msg.snippet,
    };
  }
  const { data, error } = await supabaseAdmin.schema("crm").rpc("store_ingested_email", { p });
  if (error) throw new Error(`store_ingested_email failed: ${error.message}`);
  await maybeRequestReplyDraft(plan, msg, c.direction, data, c.deliveredToCrm);
}

// ---------- Riley reply drafts (R73, R74) ----------

/** Mail older than this is never drafted for: stops the 7-day re-sync and a first sync from drafting a backlog. */
export const REPLY_DRAFT_MAX_AGE_MS = 72 * 3_600_000;

type StoreResult = { email_message_id?: unknown; newly_stored?: unknown } | null;

/**
 * Asks Riley for an approval-gated reply draft when a lead's or client's email is newly stored.
 * Never throws and never delays ingestion: the call runs in after() (the Pub/Sub push route is the only
 * caller and has a request scope); outside a request scope it is awaited instead, capped at 10s by the
 * client timeout. Failures are logged (R74), never rethrown.
 */
function maybeRequestReplyDraft(plan: IngestPlan, msg: GmailMessage, direction: Direction, result: unknown, deliveredToCrm: boolean): void | Promise<void> {
  if (direction !== "received" || plan.kind !== "log") return;
  if (deliveredToCrm) return; // Brian's forward to crm@ (source 'forward') is not a lead email to answer
  if (!plan.links.some((l) => l.lead_id || l.client_id)) return;
  const r = result as StoreResult;
  if (!r || r.newly_stored !== true || typeof r.email_message_id !== "string") return;
  if (!(msg.internalDate > 0) || Date.now() - msg.internalDate > REPLY_DRAFT_MAX_AGE_MS) return;

  const id = r.email_message_id;
  const hasListUnsubscribe = Boolean(msg.headers["list-unsubscribe"]);
  const dispatch = async (): Promise<void> => {
    try {
      const res = await requestDraftReply(id, hasListUnsubscribe);
      if (res.ok) return;
      if (res.kind === "timeout") console.info("riley draft-reply dispatched (timeout)", id); // Riley keeps working
      else console.error("riley draft-reply failed", id, res.kind);
    } catch (e) {
      console.error("riley draft-reply failed", id, e instanceof Error ? e.name : "error");
    }
  };
  try {
    after(dispatch);
  } catch {
    return dispatch(); // no request scope: await it
  }
}
