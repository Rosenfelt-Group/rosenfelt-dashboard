// Server-only. The unmatched-email queue: list with suggestions (R17) and resolve.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { intakeLead } from "@/lib/intake/client";
import { loadContactsByEmail, normalizeEmail, type ContactRef } from "@/lib/email/ingest";
import { emailDomain, FREE_MAIL_DOMAINS, suggestContact, type SuggestContact } from "./suggest";

export class InboxError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type UnmatchedRow = {
  id: string; email_message_id: string | null; contact_email: string; direction: string | null; subject: string | null;
  snippet: string | null; timestamp: string | null; suggested_contact_id: string | null; suggestion_checked_at: string | null;
  message: { from_email: string | null; from_name: string | null; subject: string | null; snippet: string | null; sent_at: string | null } | null;
};
export type InboxItem = {
  id: string; email_message_id: string | null; contact_email: string; direction: string | null; subject: string | null;
  snippet: string | null; timestamp: string | null; from_name: string | null; sent_at: string | null;
  suggested_contact: { id: string; name: string; email: string | null } | null;
};

const LIMIT = 200;
const CONTACT_COLS = "id, first_name, last_name, email_norm";
const SAFE_DOMAIN = /^[a-z0-9.-]+$/;
const SAFE_NAME = /^[\p{L}'.-]+$/u; // safe inside a PostgREST or() filter: no commas, parens or wildcards
const toSuggest = (c: Record<string, unknown>): SuggestContact => ({
  id: c.id as string, first_name: (c.first_name as string) ?? null, last_name: (c.last_name as string) ?? null, email: (c.email_norm as string) ?? null,
});
const nameOf = (c: SuggestContact) => [c.first_name, c.last_name].filter(Boolean).join(" ");

export async function listInbox(): Promise<InboxItem[]> {
  const db = supabaseAdmin.schema("crm");
  const { data, error } = await db
    .from("unmatched_email_log")
    .select("id, email_message_id, contact_email, direction, subject, snippet, timestamp, suggested_contact_id, suggestion_checked_at, message:email_messages(from_email, from_name, subject, snippet, sent_at)")
    .is("resolved_at", null)
    .order("timestamp", { ascending: false })
    .limit(LIMIT);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as UnmatchedRow[];

  // The From display name only describes the candidate when the candidate is the sender.
  const nameFor = (r: UnmatchedRow) =>
    r.message?.from_name && r.message.from_email && normalizeEmail(r.message.from_email) === normalizeEmail(r.contact_email) ? r.message.from_name : null;

  // R41: each row is looked at once. suggestion_checked_at is set whether or not a suggestion was found.
  const need = rows.filter((r) => !r.suggestion_checked_at && !r.suggested_contact_id);
  const pool = new Map<string, SuggestContact>();
  const addAll = (list: unknown) => { for (const c of (list ?? []) as Record<string, unknown>[]) pool.set(c.id as string, toSuggest(c)); };
  const suggested = new Map<string, string>(); // unmatched id -> contact id

  if (need.length) {
    const domains = [...new Set(need.map((r) => emailDomain(r.contact_email)).filter((d): d is string => !!d && SAFE_DOMAIN.test(d) && !(FREE_MAIL_DOMAINS as readonly string[]).includes(d)))];
    const firsts = [...new Set(need.map(nameFor).filter((n): n is string => !!n).map((n) => n.trim().split(/\s+/)[0]).filter((f) => SAFE_NAME.test(f)))];
    // One query per rule (not per row), in parallel.
    const lookups = [];
    if (domains.length) lookups.push(db.from("contacts").select(CONTACT_COLS).or(domains.map((d) => `email_norm.ilike.%@${d}`).join(",")).limit(1000));
    if (firsts.length) lookups.push(db.from("contacts").select(CONTACT_COLS).or(firsts.map((f) => `first_name.ilike.${f}`).join(",")).limit(1000));
    for (const r of await Promise.all(lookups)) {
      if (r.error) throw new Error(r.error.message);
      addAll(r.data);
    }

    for (const r of need) {
      const id = suggestContact({ email: r.contact_email, name: nameFor(r) }, [...pool.values()]);
      if (id) suggested.set(r.id, id);
    }
    // Persist, never overwriting a value or touching a row resolved meanwhile.
    const checkedAt = new Date().toISOString();
    const writes = [...suggested].map(([rowId, contactId]) =>
      db.from("unmatched_email_log").update({ suggested_contact_id: contactId, suggestion_checked_at: checkedAt }).eq("id", rowId).is("suggestion_checked_at", null).is("resolved_at", null));
    const none = need.filter((r) => !suggested.has(r.id)).map((r) => r.id);
    if (none.length) writes.push(db.from("unmatched_email_log").update({ suggestion_checked_at: checkedAt }).in("id", none).is("suggestion_checked_at", null).is("resolved_at", null));
    for (const w of await Promise.all(writes)) if (w.error) console.error("persist suggestion failed:", w.error.message);
  }

  const wantIds = [...new Set(rows.map((r) => r.suggested_contact_id ?? suggested.get(r.id)).filter((x): x is string => !!x && !pool.has(x)))];
  if (wantIds.length) {
    const r = await db.from("contacts").select(CONTACT_COLS).in("id", wantIds);
    if (r.error) throw new Error(r.error.message);
    addAll(r.data);
  }

  return rows.map((r) => {
    const sid = r.suggested_contact_id ?? suggested.get(r.id) ?? null;
    const c = sid ? pool.get(sid) : undefined;
    return {
      id: r.id, email_message_id: r.email_message_id, contact_email: r.contact_email, direction: r.direction,
      subject: r.subject ?? r.message?.subject ?? null, snippet: r.snippet ?? r.message?.snippet ?? null, timestamp: r.timestamp,
      from_name: r.message?.from_name ?? null, sent_at: r.message?.sent_at ?? null,
      suggested_contact: c ? { id: c.id, name: nameOf(c), email: c.email } : null,
    };
  });
}

export type ResolveInput = { unmatched_id: string; contact_id?: string; create?: { email: string; name?: string; org?: string } };

/**
 * Link the queued message to a contact and back-fill the activity by re-storing the message through
 * crm.store_ingested_email (idempotent), then mark the row resolved. The store runs first, so a failed
 * store leaves the row queued and a retry repairs it.
 */
export async function resolveUnmatched(input: ResolveInput): Promise<{ contact_id: string; lead_id: string | null; created_contact: boolean }> {
  const db = supabaseAdmin.schema("crm");
  const { data: row, error: rErr } = await db.from("unmatched_email_log").select("id, email_message_id, contact_email, resolved_at").eq("id", input.unmatched_id).maybeSingle();
  if (rErr) throw new Error(rErr.message);
  if (!row) throw new InboxError("Unmatched email not found", 404);
  if (row.resolved_at) throw new InboxError("Already resolved", 409);
  if (!row.email_message_id) throw new InboxError("This row has no stored message to link", 422);

  const { data: m, error: mErr } = await db.from("email_messages").select("gmail_message_id, thread_id, rfc_message_id, direction, from_email, from_name, to_emails, cc_emails, subject, snippet, body_text, sent_at, source, delivered_to_crm").eq("id", row.email_message_id).maybeSingle();
  if (mErr) throw new Error(mErr.message);
  if (!m) throw new InboxError("Stored message not found", 404);

  let ref: ContactRef;
  let created = false;
  if (input.create) {
    const r = await intakeLead({ channel: "email_inbound", email: input.create.email, name: input.create.name, org: input.create.org });
    created = r.created_contact;
    ref = (await loadContactsByEmail([input.create.email])).get(normalizeEmail(input.create.email)) ?? { contact_id: r.contact_id, lead_id: r.lead_id, client_id: null };
  } else {
    const { data: c, error: cErr } = await db.from("contacts").select("id, email_norm").eq("id", input.contact_id!).maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!c) throw new InboxError("Contact not found", 404);
    ref = (c.email_norm ? (await loadContactsByEmail([c.email_norm as string])).get(c.email_norm as string) : undefined) ?? { contact_id: c.id as string, lead_id: null, client_id: null };
  }

  const sent = m.direction === "sent";
  const p = {
    message: {
      gmail_message_id: m.gmail_message_id, thread_id: m.thread_id, rfc_message_id: m.rfc_message_id, direction: m.direction,
      from_email: m.from_email, from_name: m.from_name, to_emails: m.to_emails ?? [], cc_emails: m.cc_emails ?? [],
      subject: m.subject, snippet: m.snippet, body_text: m.body_text, sent_at: m.sent_at, source: m.source, delivered_to_crm: m.delivered_to_crm,
    },
    links: [{ contact_id: ref.contact_id, lead_id: ref.lead_id, client_id: ref.client_id }],
    activity: { activity_type: sent ? "email_sent" : "email_received", email_direction: m.direction, email_subject: m.subject, content: m.snippet },
  };
  const { error: sErr } = await db.rpc("store_ingested_email", { p });
  if (sErr) throw new Error(`store_ingested_email failed: ${sErr.message}`);

  // Conditional update: a concurrent resolver that got here first leaves 0 rows for us (the store above is idempotent).
  const { data: upd, error: uErr } = await db.from("unmatched_email_log").update({ resolved_at: new Date().toISOString(), resolved_contact_id: ref.contact_id }).eq("id", row.id).is("resolved_at", null).select("id");
  if (uErr) throw new Error(uErr.message);
  if (!upd || upd.length === 0) throw new InboxError("Already resolved", 409);
  return { contact_id: ref.contact_id, lead_id: ref.lead_id, created_contact: created };
}
