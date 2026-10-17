import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { SendInviteEmailSchema } from "@/lib/rooms/schemas";
import { hashToken, isPlausibleToken, roomLink } from "@/lib/rooms/token";
import { roomInviteEmail } from "@/lib/rooms/invite-email";
import { sendEmail, isValidEmail, EmailError } from "@/lib/email";
import { sessionUsername } from "@/lib/rooms/session-user";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string; accessId: string }> };

// POST — email the room invite for this link. The raw link is only ever held by the browser (it is
// shown once), so the client sends it back; it must hash to this access row's token, so the route
// can only send a real, live link for this room. The link is never logged or stored.
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id, accessId } = await params;
  if (!UUID.test(id) || !UUID.test(accessId)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const parsed = SendInviteEmailSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { to, link, first_name, refreshed, time_zone } = parsed.data;
  if (!isValidEmail(to)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const token = link.split("/r/").pop() ?? "";
  if (!isPlausibleToken(token) || roomLink(token) !== link) {
    return NextResponse.json({ error: "That isn't a room link." }, { status: 400 });
  }

  const rooms = supabaseAdmin.schema("rooms");
  const [{ data: access }, { data: eng }] = await Promise.all([
    rooms.from("engagement_access").select("id, token_hash, expires_at, revoked_at")
      .eq("id", accessId).eq("engagement_id", id).maybeSingle(),
    rooms.from("engagements").select("id, title, status, business_id, lead_id").eq("id", id).maybeSingle(),
  ]);
  if (!access || !eng || access.token_hash !== hashToken(token)) {
    return NextResponse.json({ error: "Link not found." }, { status: 404 });
  }
  if (access.revoked_at || new Date(access.expires_at).getTime() <= Date.now() || eng.status === "closed") {
    return NextResponse.json({ error: "This link is revoked or expired, or the room is closed." }, { status: 409 });
  }

  const { data: biz } = await supabaseAdmin.schema("crm").from("businesses").select("name").eq("id", eng.business_id).maybeSingle();
  const invite = roomInviteEmail({
    firstName: first_name, orgName: biz?.name, roomTitle: eng.title,
    link, expiresAt: access.expires_at, refreshed, timeZone: time_zone,
  });

  let sent: { id: string };
  try {
    sent = await sendEmail({ to, subject: invite.subject, text: invite.body, fromName: "Brian Rosenfelt" });
  } catch (e) {
    if (e instanceof EmailError && e.code === "not_configured") {
      return NextResponse.json({ error: "Email isn't set up. Copy the invite instead." }, { status: 503 });
    }
    if (e instanceof EmailError && e.code === "invalid_input") {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    return NextResponse.json({ error: "The email couldn't be sent. Copy the invite instead." }, { status: 502 });
  }

  // Timeline entry on the lead, when the room has one. A logging failure doesn't undo a sent email.
  if (eng.lead_id) {
    const by = (await sessionUsername(req)) ?? "brian";
    await supabaseAdmin.schema("crm").from("lead_activities").insert({
      lead_id: eng.lead_id,
      activity_type: "system",
      logged_by: by,
      content: `Room ${refreshed ? "new link" : "invite"} emailed to ${to}: ${eng.title}`,
      metadata: { engagement_id: id, access_id: accessId, gmail_message_id: sent.id },
    }).then(({ error }) => { if (error) console.error("room invite email: activity log failed", error.message); });
  }

  return NextResponse.json({ ok: true, id: sent.id, logged: Boolean(eng.lead_id) });
}
