// Server-only. The ONLY module allowed to send mail as brian@rosably.com (enforced by gmail-user.test.ts).
// Two entry points: executeApproval(id) for approved `email_send` pending_approvals rows (drafted by Riley),
// and sendEmail(..., "compose") for Brian's direct compose. Recipients come only from the validated payload.
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildRfc822Message, gmailRead, gmailSend } from "./gmail-user";
import { BRIAN, loadContactsByEmail, normalizeEmail } from "./ingest";

export const FROM = { name: "Brian Rosenfelt", email: BRIAN };
export const STALE_EXECUTING_MS = 10 * 60_000;

const emailAddr = z.string().trim().email().max(320);

export const emailPayloadSchema = z.object({
  to: z.array(emailAddr).min(1).max(10),
  cc: z.array(emailAddr).max(10).optional(),
  subject: z.string().min(1).max(300),
  body_text: z.string().min(1).max(50_000),
  reply_to_email_message_id: z.string().uuid().optional(),
});
export type EmailInput = z.infer<typeof emailPayloadSchema>;
export type SendSource = "executor" | "compose";
export type SendResult = { gmail_message_id: string; thread_id: string; store_error?: string };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const uniq = (a: string[]) => [...new Set(a.map(normalizeEmail))];

/** Sends one message as Brian, then stores it. A store failure after a successful send is reported, not thrown. */
export async function sendEmail(input: EmailInput, source: SendSource): Promise<SendResult> {
  const to = uniq(input.to);
  const cc = uniq(input.cc ?? []).filter((e) => !to.includes(e));

  let inReplyTo: string | undefined;
  let threadId: string | undefined;
  if (input.reply_to_email_message_id) {
    const { data, error } = await supabaseAdmin
      .schema("crm")
      .from("email_messages")
      .select("rfc_message_id, thread_id")
      .eq("id", input.reply_to_email_message_id)
      .single();
    if (error || !data) throw new Error(`reply target not found: ${input.reply_to_email_message_id}`);
    inReplyTo = (data.rfc_message_id as string | null) ?? undefined;
    threadId = (data.thread_id as string | null) ?? undefined;
  }

  const { raw, messageId } = buildRfc822Message({
    from: FROM,
    to,
    cc,
    subject: input.subject,
    text: input.body_text,
    ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
  });
  const sent = await gmailSend().send(raw, threadId ? { threadId } : undefined);

  // The send has happened; nothing below may make this call fail.
  const out: SendResult = { gmail_message_id: sent.id, thread_id: sent.threadId };
  // Gmail REPLACES our generated Message-ID with its own (<...@mail.gmail.com>), so read the real one back
  // (best effort). On any failure keep the generated id; the watch sync's upsert corrects it later.
  let rfcMessageId = messageId;
  try {
    const real = await gmailRead().getRfcMessageId(sent.id);
    if (real) rfcMessageId = real;
  } catch (e) {
    console.error("email executor: could not read back Message-ID, using generated", sent.id, errMsg(e));
  }
  try {
    const refs = await loadContactsByEmail([...to, ...cc]);
    const links: { contact_id: string; lead_id: string | null; client_id: string | null }[] = [];
    const seen = new Set<string>();
    for (const e of [...to, ...cc]) {
      const r = refs.get(e);
      if (r && !seen.has(r.contact_id)) {
        seen.add(r.contact_id);
        links.push({ contact_id: r.contact_id, lead_id: r.lead_id, client_id: r.client_id });
      }
    }
    const p = {
      message: {
        gmail_message_id: sent.id,
        thread_id: sent.threadId,
        rfc_message_id: rfcMessageId, // Gmail's own id read back after send; falls back to the generated (provisional) one
        direction: "sent",
        from_email: BRIAN,
        from_name: FROM.name,
        to_emails: to,
        cc_emails: cc,
        subject: input.subject,
        snippet: input.body_text.slice(0, 200),
        body_text: input.body_text,
        sent_at: new Date().toISOString(),
        source,
        delivered_to_crm: false,
      },
      links,
      activity: { activity_type: "email_sent", email_direction: "sent", email_subject: input.subject, content: input.body_text.slice(0, 200) },
    };
    const { error } = await supabaseAdmin.schema("crm").rpc("store_ingested_email", { p });
    if (error) throw new Error(error.message);
  } catch (e) {
    out.store_error = `store_ingested_email failed: ${errMsg(e)}`;
    console.error("email executor: store failed after send", out.gmail_message_id, errMsg(e));
  }
  return out;
}

export type ExecuteOutcome = { status: "done" | "failed" | "skipped"; gmail_message_id?: string; error?: string };

export async function executeApproval(id: string): Promise<ExecuteOutcome> {
  const now = new Date().toISOString();
  // Atomic claim: only one caller can move approved -> executing.
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from("pending_approvals")
    // executed_at is stamped at claim time, so a row can be claimed at most once, ever (R34).
    .update({ status: "executing", executing_since: now, executed_at: now })
    .eq("id", id)
    .eq("status", "approved")
    .eq("action_type", "email_send")
    .is("executed_at", null)
    .not("reviewed_by", "is", null)
    .select("id, payload");
  if (claimErr) throw new Error(`claim failed: ${claimErr.message}`);
  if (!claimed || claimed.length === 0) return { status: "skipped" };

  const fail = async (error: string): Promise<ExecuteOutcome> => {
    const { error: uErr } = await supabaseAdmin.from("pending_approvals").update({ status: "failed", error }).eq("id", id).eq("status", "executing");
    if (uErr) console.error("email executor: could not record failure", id, uErr.message);
    return { status: "failed", error };
  };

  const parsed = emailPayloadSchema.safeParse(claimed[0].payload);
  if (!parsed.success) return fail(`invalid payload: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);

  let res: SendResult;
  try {
    res = await sendEmail(parsed.data, "executor");
  } catch (e) {
    return fail(errMsg(e));
  }
  const { error: uErr } = await supabaseAdmin
    .from("pending_approvals")
    .update({ status: "done", result: res, error: null })
    .eq("id", id)
    .eq("status", "executing");
  // Mail is already sent; never report failure for a bookkeeping error. (If this write fails the sweep
  // will later mark the row failed, which is why the error is logged loudly.)
  if (uErr) console.error("email executor: SENT but could not mark done", id, res.gmail_message_id, uErr.message);
  return { status: "done", gmail_message_id: res.gmail_message_id };
}

/** Marks rows stuck in 'executing' for more than 10 minutes as failed. Returns how many were swept. */
export async function sweepStaleExecuting(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_EXECUTING_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("pending_approvals")
    .update({ status: "failed", error: "stale executing" })
    .eq("status", "executing")
    .or(`executing_since.lt.${cutoff},executing_since.is.null`)
    .select("id");
  if (error) throw new Error(`stale sweep failed: ${error.message}`);
  return data?.length ?? 0;
}
