import { NextRequest, NextResponse } from "next/server";
import { SendInviteEmailSchema } from "@/lib/rooms/schemas";
import { isPlausibleToken, roomLink } from "@/lib/rooms/token";
import { sendRoomInvite } from "@/lib/rooms/send-invite";
import { isValidEmail } from "@/lib/email";
import { sessionUsername } from "@/lib/rooms/session-user";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string; accessId: string }> };

// POST — email the room invite for this link. The raw link is only ever held by the browser (it is
// shown once), so the client sends it back; sendRoomInvite checks it hashes to this access row's token,
// so the route can only send a real, live link for this room. The link is never logged or stored.
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

  const r = await sendRoomInvite({
    engagementId: id, accessId, to, link, firstName: first_name, refreshed, timeZone: time_zone,
    by: (await sessionUsername(req)) ?? "brian",
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, id: r.id, logged: r.logged });
}
