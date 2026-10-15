import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { RefreshAccessSchema } from "@/lib/rooms/schemas";
import { generateToken, hashToken, roomLink } from "@/lib/rooms/token";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string; accessId: string }> };

// POST — revoke this link and issue its replacement in one database transaction (rooms.refresh_access).
// The new raw token is returned exactly once; only its hash reaches the database; it is never logged.
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id, accessId } = await params;
  if (!UUID.test(id) || !UUID.test(accessId)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const parsed = RefreshAccessSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const raw = generateToken();
  const expiresAt = new Date(Date.now() + parsed.data.expires_days * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin.schema("rooms").rpc("refresh_access", {
    p_eng: id, p_access: accessId, p_token_hash: hashToken(raw), p_expires_at: expiresAt,
  });
  if (error) {
    if (error.code === "P0002") return NextResponse.json({ error: "Link not found." }, { status: 404 });
    if (error.code === "P0001") {
      return NextResponse.json({ error: "This link can't be refreshed: it was already revoked or the room is closed." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not refresh this link." }, { status: 500 });
  }
  const row = (Array.isArray(data) ? data[0] : data) as { access_id: string; expires_at: string } | null;
  if (!row) return NextResponse.json({ error: "Could not refresh this link." }, { status: 500 });
  return NextResponse.json({ id: row.access_id, link: roomLink(raw), expires_at: row.expires_at }, { status: 201 });
}
