import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Fire-and-forget: ask the assigned agent to post a `progress` log entry on
// the work item. The agent's response lands in work_item_logs and the
// dashboard picks it up via Realtime — we don't await the agent here.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data: item, error } = await supabaseAdmin
    .from("work_items")
    .select("assigned_agent")
    .eq("id", id)
    .single();
  if (error || !item) {
    return NextResponse.json({ error: "work item not found" }, { status: 404 });
  }
  if (!item.assigned_agent || item.assigned_agent === "brian") {
    return NextResponse.json(
      { error: "no agent assigned — assign a real agent first" },
      { status: 400 },
    );
  }

  const cookieHeader = req.headers.get("cookie") ?? "";
  // Fire and forget — return 202 immediately. Agent posts progress to
  // work_item_logs which the UI reflects via Realtime.
  fetch(`${req.nextUrl.origin}/api/work/${id}/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookieHeader },
    body: JSON.stringify({ action: "get_status", suppress_notify: true }),
  }).catch((e) => console.error("status-check dispatch failed:", e));

  return NextResponse.json({ requested: true }, { status: 202 });
}
