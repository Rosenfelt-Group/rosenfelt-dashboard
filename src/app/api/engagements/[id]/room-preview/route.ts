import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { signPreviewToken } from "@/lib/rooms/grant";
import { previewRoomLink } from "@/lib/rooms/token";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// POST — mint a 5-minute link that opens the portal's staff preview of this room (drafts included).
// Dashboard only (the middleware requires a session). The token is never logged or stored.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const secret = process.env.ROOM_GRANT_SECRET;
  if (!secret) return NextResponse.json({ error: "ROOM_GRANT_SECRET is not configured" }, { status: 500 });
  const { data: eng } = await supabaseAdmin.schema("rooms").from("engagements").select("id").eq("id", id).maybeSingle();
  if (!eng) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  let token: string;
  try { token = signPreviewToken(id, secret); }
  catch { return NextResponse.json({ error: "Could not create the preview link." }, { status: 500 }); }
  return NextResponse.json({ url: previewRoomLink(token) }, { headers: { "Cache-Control": "private, no-store" } });
}
