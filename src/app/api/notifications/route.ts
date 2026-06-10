import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

// Notifications are per-recipient. Scope reads to the authenticated user
// (recipient == session.username) so one dashboard user cannot see another's
// notifications. Agents currently write recipient='brian'; Brian's session
// username is 'brian', so his bell is populated and other users see only their own.
export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .select("id, created_at, agent, message, urgency, read_at, work_item_id, link_url")
    .eq("recipient", session.username)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const unread = (data ?? []).filter((n) => n.read_at === null).length;
  return NextResponse.json({ notifications: data ?? [], unread });
}
