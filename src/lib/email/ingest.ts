// Server-only. Pure classification/matching for Gmail messages plus a store step (applyIngest).
// Message bodies are untrusted data: they are stored and parsed for addresses only, never interpreted.
import { supabaseAdmin } from "@/lib/supabase-admin";
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
export type ForwardedOriginal = { email: string; name: string };
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

/** Parse a forwarded-header block out of a body (Gmail or Outlook style). */
export function parseForwardedOriginal(body: string): ForwardedOriginal | undefined {
  const lines = body.split(/\r?\n/).map((l) => l.replace(/^[>\s]+/, ""));
  const fromOf = (line: string): ForwardedOriginal | undefined => {
    const m = line.match(/^\*?From:\*?\s*(.+)$/i);
    if (!m) return undefined;
    const a = parseAddressList(m[1].replace(/<mailto:[^>]*>/gi, ""))[0];
    return a ? { email: a.email, name: a.name } : undefined;
  };
  for (let i = 0; i < lines.length; i++) {
    if (/^-{3,}\s*Forwarded message\s*-{3,}$/i.test(lines[i].trim())) {
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const f = fromOf(lines[j].trim());
        if (f) return f;
      }
    }
  }
  for (let i = 0; i + 1 < lines.length; i++) {
    if (/^\*?Sent:\*?\s/i.test(lines[i + 1].trim())) {
      const f = fromOf(lines[i].trim());
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
    const original = parseForwardedOriginal(msg.bodyText);
    if (original && original.email !== me) {
      return { direction: "received", participants: exclude([original.email]), deliveredToCrm, forwardedOriginal: original };
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
  | { kind: "unmatched"; email: string }
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
  const candidate = c.participants[0];
  if (!candidate) return { kind: "skip", reason: "no_candidate" };
  return { kind: "unmatched", email: candidate };
}

// ---------- Contact lookup (one query per table) ----------

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

export async function loadContactsByEmail(emails: string[]): Promise<Map<string, ContactRef>> {
  const out = new Map<string, ContactRef>();
  const norm = uniq(emails.map(normalizeEmail).filter(Boolean));
  if (!norm.length) return out;
  const db = supabaseAdmin.schema("crm");

  const { data: contacts, error: cErr } = await db.from("contacts").select("id, email_norm, business_id").in("email_norm", norm);
  if (cErr) throw new Error(`contacts lookup failed: ${cErr.message}`);
  if (!contacts?.length) return out;
  const ids = contacts.map((c) => c.id as string);
  const bizIds = uniq(contacts.map((c) => c.business_id as string | null).filter((b): b is string => !!b));

  const { data: leads, error: lErr } = await db
    .from("leads")
    .select("id, contact_id, stage, created_at")
    .in("contact_id", ids)
    .order("created_at", { ascending: false });
  if (lErr) throw new Error(`leads lookup failed: ${lErr.message}`);

  const filter = [`contact_id.in.(${ids.join(",")})`, bizIds.length ? `business_id.in.(${bizIds.join(",")})` : ""].filter(Boolean).join(",");
  const { data: clients, error: kErr } = await db
    .from("clients")
    .select("id, contact_id, business_id, created_at")
    .or(filter)
    .neq("billing_status", "cancelled")
    .order("created_at", { ascending: false });
  if (kErr) throw new Error(`clients lookup failed: ${kErr.message}`);

  for (const c of contacts) {
    const mine = (leads ?? []).filter((l) => l.contact_id === c.id); // newest first
    const lead =
      mine.find((l) => l.stage !== "won" && l.stage !== "lost") ?? mine.find((l) => l.stage === "won") ?? null;
    const own = (clients ?? []).find((k) => k.contact_id === c.id);
    const client = own ?? (c.business_id ? (clients ?? []).find((k) => k.business_id === c.business_id) : undefined);
    out.set(c.email_norm as string, { contact_id: c.id as string, lead_id: (lead?.id as string) ?? null, client_id: (client?.id as string) ?? null });
  }
  return out;
}

// ---------- Store ----------

export async function applyIngest(plan: IngestPlan, msg: GmailMessage, brian = BRIAN): Promise<void> {
  if (plan.kind === "skip") return;
  const c = classify(msg, brian);
  const db = supabaseAdmin.schema("crm");

  const fromHdr = parseAddressList(msg.headers["from"])[0];
  const sender = c.forwardedOriginal ?? (fromHdr ? { email: fromHdr.email, name: fromHdr.name } : undefined);
  const subject = msg.headers["subject"] ? decodeMimeWords(msg.headers["subject"]) : null;

  const { data: row, error: mErr } = await db
    .from("email_messages")
    .upsert(
      {
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
      { onConflict: "gmail_message_id" },
    )
    .select("id")
    .single();
  if (mErr || !row) throw new Error(`email_messages upsert failed: ${mErr?.message ?? "no row"}`);
  const messageId = row.id as string;

  if (plan.kind === "unmatched") {
    const { data: existing, error: eErr } = await db.from("unmatched_email_log").select("id").eq("email_message_id", messageId).limit(1);
    if (eErr) throw new Error(`unmatched_email_log lookup failed: ${eErr.message}`);
    if (existing?.length) return;
    const { error } = await db.from("unmatched_email_log").insert({
      contact_email: plan.email,
      subject,
      direction: "received",
      snippet: msg.snippet,
      logged_by: "system",
      email_message_id: messageId,
      suggested_contact_id: null,
    });
    if (error) throw new Error(`unmatched_email_log insert failed: ${error.message}`);
    return;
  }

  const { data: inserted, error: lErr } = await db
    .from("email_message_links")
    .upsert(
      plan.links.map((l) => ({ email_message_id: messageId, contact_id: l.contact_id, lead_id: l.lead_id, client_id: l.client_id })),
      { onConflict: "email_message_id,contact_id", ignoreDuplicates: true },
    )
    .select("contact_id");
  if (lErr) throw new Error(`email_message_links insert failed: ${lErr.message}`);

  // Only links newly inserted by this call get an activity, so re-delivery never duplicates.
  const fresh = new Set((inserted ?? []).map((r) => r.contact_id as string));
  const activities = plan.links
    .filter((l) => fresh.has(l.contact_id))
    .map((l) => ({
      lead_id: l.lead_id,
      contact_id: l.contact_id,
      client_id: l.client_id,
      activity_type: c.direction === "sent" ? "email_sent" : "email_received",
      email_direction: c.direction,
      email_subject: subject,
      content: msg.snippet,
      logged_by: "system",
      metadata: { email_message_id: messageId, gmail_message_id: msg.id },
    }));
  if (!activities.length) return;
  const { error: aErr } = await db.from("lead_activities").insert(activities);
  if (aErr) throw new Error(`lead_activities insert failed: ${aErr.message}`);
}
