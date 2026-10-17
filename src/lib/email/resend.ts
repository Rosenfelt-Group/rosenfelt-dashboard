import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendEmail, emailProvider, isValidEmail, EmailError } from "@/lib/email";
import { listSuppressions, unsuppress, getMessage } from "./postmark-api";
import { getEvent, resolveEvents, logAction, type EmailEvent } from "./events";
import { refreshAccess } from "@/lib/rooms/refresh-access";
import { sendRoomInvite } from "@/lib/rooms/send-invite";
import { emailInvite } from "@/lib/discovery/email";

// Server-only. Resend a bounced email, per source (see the Email health design, "Resend").
// A room invite's secret link is never resent from storage: the link is refreshed and a new one sent.

export type ResendResult =
  | { ok: true; messageId: string; contactUpdated?: boolean }
  | { ok: false; status: number; error: string };

type Fail = Extract<ResendResult, { ok: false }>;
type Sent = { ok: true; messageId: string } | Fail;
type Contact = { id: string; email: string | null; first_name: string | null };

const NOT_RESENDABLE = "This email can't be resent from the dashboard.";
const SPAM = "Blocked permanently — this person marked us as spam.";
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

function postmarkFailure(e: unknown): Fail {
  if (e instanceof EmailError && e.code === "not_configured") return fail(503, "Postmark isn't set up on the server.");
  if (e instanceof EmailError && e.code === "auth_failed") {
    return fail(502, "Postmark rejected our login. The server token may be wrong or revoked.");
  }
  console.error("email resend: postmark failed:", e);
  return fail(502, "Couldn't reach Postmark. Please try again in a moment.");
}

// The contact on a CRM lead (crm.leads.contact_id → crm.contacts), or null.
async function leadContact(leadId: string | null | undefined): Promise<Contact | null> {
  if (!leadId) return null;
  const crm = supabaseAdmin.schema("crm");
  const { data: lead } = await crm.from("leads").select("contact_id").eq("id", leadId).maybeSingle();
  if (!lead?.contact_id) return null;
  const { data: contact } = await crm.from("contacts").select("id, email, first_name").eq("id", lead.contact_id).maybeSingle();
  return (contact as Contact | null) ?? null;
}

// Saves a corrected address on the contact; true only when the stored email actually changed.
async function updateContactEmail(contact: Contact | null, to: string): Promise<boolean> {
  if (!contact || contact.email?.trim().toLowerCase() === to.toLowerCase()) return false;
  const { error } = await supabaseAdmin.schema("crm").from("contacts").update({ email: to }).eq("id", contact.id);
  if (error) console.error("email resend: contact email update failed:", error.message);
  return !error;
}

async function resendRoomInvite(ev: EmailEvent, to: string, contact: Contact | null, by: string): Promise<Sent> {
  const { engagement_id: engagementId, access_id: accessId } = ev.metadata;
  const fresh = await refreshAccess(engagementId, accessId);
  if (!fresh.ok) return fresh;
  const r = await sendRoomInvite({
    engagementId, accessId: fresh.accessId, to, link: fresh.link,
    firstName: contact?.first_name ?? undefined, refreshed: true, by,
  });
  return r.ok ? { ok: true, messageId: r.id } : r;
}

async function resendDiscoveryInvite(ev: EmailEvent, to: string, contact: Contact | null): Promise<Sent> {
  const r = await emailInvite(ev.metadata.discovery_invite_id, { to, firstName: contact?.first_name ?? undefined });
  return r.sent ? { ok: true, messageId: r.id } : fail(r.status, r.error);
}

async function resendCopy(ev: EmailEvent, to: string): Promise<Sent> {
  if (!ev.message_id) return fail(422, NOT_RESENDABLE);
  let msg: Awaited<ReturnType<typeof getMessage>>;
  try {
    msg = await getMessage(ev.message_id);
  } catch (e) {
    return postmarkFailure(e);
  }
  if (msg.hasAttachments) return fail(422, "This email had an attachment, so it can't be resent from the dashboard.");
  if (!msg.textBody && !msg.htmlBody) return fail(422, "Postmark no longer has this email's content, so it can't be resent.");
  try {
    const { id } = await sendEmail({
      to, subject: msg.subject, text: msg.textBody ?? "", html: msg.htmlBody, tag: ev.tag ?? undefined,
      fromName: "Brian Rosenfelt", replyTo: "brian@rosably.com",
    });
    return { ok: true, messageId: id };
  } catch (e) {
    if (e instanceof EmailError && e.code === "invalid_input") return fail(400, "Enter a valid email address.");
    if (e instanceof EmailError && e.code === "not_configured") return fail(503, "Postmark isn't set up on the server.");
    console.error("email resend: send failed:", e);
    return fail(502, "The email couldn't be sent. Please try again in a moment.");
  }
}

export async function resendEvent(eventId: string, opts: { to?: string; unblock?: boolean; by: string }): Promise<ResendResult> {
  const ev = await getEvent(eventId);
  if (!ev || ev.record_type === "Delivery") return fail(404, "That problem was not found.");
  if (ev.resolved_at) return fail(409, "That problem is already resolved.");

  // Which path rebuilds this email; refuse anything without one before touching Postmark.
  const tag = ev.tag ?? "";
  if (tag === "n8n-avery-deliver-audit") return fail(422, "Re-run the delivery from n8n (avery-deliver-audit).");
  const dashboard = tag === "dashboard-room-invite" || tag === "dashboard-discovery-invite";
  if (!dashboard && tag !== "n8n-stripe-buyer" && tag !== "n8n-typeform-intake") return fail(422, NOT_RESENDABLE);
  if (tag === "dashboard-room-invite" && !(ev.metadata?.engagement_id && ev.metadata?.access_id)) return fail(422, NOT_RESENDABLE);
  if (tag === "dashboard-discovery-invite" && !ev.metadata?.discovery_invite_id) return fail(422, NOT_RESENDABLE);

  const to = opts.to?.trim() || ev.recipient;
  if (!isValidEmail(to)) return fail(400, "Enter a valid email address.");
  const corrected = to.toLowerCase() !== ev.recipient.trim().toLowerCase();

  // Resends go through Postmark only, so every resend is tagged and tracked.
  if (emailProvider() !== "postmark") return fail(503, "Resend needs Postmark, which isn't set up on the server.");
  if (ev.record_type === "SpamComplaint") return fail(409, SPAM);

  let unblocked = false;
  try {
    const blocked = (await listSuppressions()).find((s) => s.email.toLowerCase() === to.toLowerCase());
    if (blocked?.reason === "SpamComplaint") return fail(409, SPAM);
    if (blocked && opts.unblock !== true) return fail(409, "This address is still blocked. Unblock it to resend.");
    if (blocked) {
      await unsuppress(to);
      unblocked = true;
    }
  } catch (e) {
    return postmarkFailure(e);
  }
  if (unblocked) await logAction({ action: "unblock", recipient: to, eventId, detail: { via: "resend" }, by: opts.by });

  let contact: Contact | null = null;
  let sent: Sent;
  if (tag === "dashboard-room-invite") {
    const { data: eng } = await supabaseAdmin.schema("rooms").from("engagements").select("lead_id").eq("id", ev.metadata.engagement_id).maybeSingle();
    contact = await leadContact(eng?.lead_id);
    sent = await resendRoomInvite(ev, to, contact, opts.by);
  } else if (tag === "dashboard-discovery-invite") {
    const { data: inv } = await supabaseAdmin.schema("crm").from("discovery_invites").select("lead_id").eq("id", ev.metadata.discovery_invite_id).maybeSingle();
    contact = await leadContact(inv?.lead_id);
    sent = await resendDiscoveryInvite(ev, to, contact);
  } else {
    sent = await resendCopy(ev, to);
  }
  if (!sent.ok) return sent;

  // The email is out; bookkeeping failures below are logged, never reported as a failed resend.
  const contactUpdated = dashboard && corrected ? await updateContactEmail(contact, to) : undefined;
  try {
    await resolveEvents({ id: eventId }, "resent", opts.by);
  } catch (e) {
    console.error("email resend: resolve failed:", e);
  }
  await logAction({
    action: "resend", recipient: to, eventId, by: opts.by,
    detail: { from_tag: tag, to, new_message_id: sent.messageId, ...(contactUpdated !== undefined ? { contactUpdated } : {}), ...(unblocked ? { unblocked } : {}) },
  });
  return { ok: true, messageId: sent.messageId, ...(contactUpdated !== undefined ? { contactUpdated } : {}) };
}
