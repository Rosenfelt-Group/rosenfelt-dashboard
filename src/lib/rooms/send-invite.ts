import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendEmail, isValidEmail, EmailError } from "@/lib/email";
import { hashToken, isPlausibleToken, roomLink } from "./token";
import { roomInviteEmail } from "./invite-email";

export type SendRoomInviteResult = { ok: true; id: string; logged: boolean } | { ok: false; status: number; error: string };

/**
 * Email the invite for one room link and record it on the lead's timeline. The raw link must hash to
 * this access row's token, so only a real, live link for this room can be sent. The link is never
 * logged or stored. Errors are safe to show the user.
 */
export async function sendRoomInvite(a: {
  engagementId: string; accessId: string; to: string; link: string;
  firstName?: string; refreshed: boolean; timeZone?: string; by: string;
}): Promise<SendRoomInviteResult> {
  if (!isValidEmail(a.to)) return { ok: false, status: 400, error: "Enter a valid email address." };
  const token = a.link.split("/r/").pop() ?? "";
  if (!isPlausibleToken(token) || roomLink(token) !== a.link) return { ok: false, status: 400, error: "That isn't a room link." };

  const rooms = supabaseAdmin.schema("rooms");
  const [{ data: access }, { data: eng }] = await Promise.all([
    rooms.from("engagement_access").select("id, token_hash, expires_at, revoked_at")
      .eq("id", a.accessId).eq("engagement_id", a.engagementId).maybeSingle(),
    rooms.from("engagements").select("id, title, status, business_id, lead_id").eq("id", a.engagementId).maybeSingle(),
  ]);
  if (!access || !eng || access.token_hash !== hashToken(token)) return { ok: false, status: 404, error: "Link not found." };
  if (access.revoked_at || new Date(access.expires_at).getTime() <= Date.now() || eng.status === "closed") {
    return { ok: false, status: 409, error: "This link is revoked or expired, or the room is closed." };
  }

  const { data: biz } = await supabaseAdmin.schema("crm").from("businesses").select("name").eq("id", eng.business_id).maybeSingle();
  const invite = roomInviteEmail({
    firstName: a.firstName, orgName: biz?.name, roomTitle: eng.title,
    link: a.link, expiresAt: access.expires_at, refreshed: a.refreshed, timeZone: a.timeZone,
  });

  let sent: { id: string };
  try {
    sent = await sendEmail({
      to: a.to, subject: invite.subject, text: invite.body, fromName: "Brian Rosenfelt",
      tag: "dashboard-room-invite", metadata: { engagement_id: a.engagementId, access_id: a.accessId },
    });
  } catch (e) {
    if (e instanceof EmailError && e.code === "not_configured") {
      return { ok: false, status: 503, error: "Email isn't set up. Copy the invite instead." };
    }
    if (e instanceof EmailError && e.code === "invalid_input") {
      return { ok: false, status: 400, error: "Enter a valid email address." };
    }
    return { ok: false, status: 502, error: "The email couldn't be sent. Copy the invite instead." };
  }

  // Timeline entry on the lead, when the room has one. A logging failure doesn't undo a sent email.
  if (eng.lead_id) {
    await supabaseAdmin.schema("crm").from("lead_activities").insert({
      lead_id: eng.lead_id,
      activity_type: "system",
      logged_by: a.by,
      content: `Room ${a.refreshed ? "new link" : "invite"} emailed to ${a.to}: ${eng.title}`,
      metadata: { engagement_id: a.engagementId, access_id: a.accessId, gmail_message_id: sent.id },
    }).then(({ error }) => { if (error) console.error("room invite email: activity log failed", error.message); });
  }

  return { ok: true, id: sent.id, logged: Boolean(eng.lead_id) };
}
