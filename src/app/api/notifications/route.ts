import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .select("id, created_at, agent, message, urgency, read_at, work_item_id")
    .eq("recipient", "brian")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const unread = (data ?? []).filter((n) => n.read_at === null).length;
  return NextResponse.json({ notifications: data ?? [], unread });
}
