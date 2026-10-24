import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// What Dr. Pickle is doing, from rows it already writes (its /health only says up/busy):
// the job(s) in progress, the queue it polls (inbox/open/approved), and its approvals waiting on Brian.
// Session-protected by the middleware like every /api route.
export const QUEUE_STATUSES = ["inbox", "open", "approved"] as const;

export async function GET() {
  try {
    const [working, queue, approvals] = await Promise.all([
      supabaseAdmin.from("work_items").select("id, ref, title")
        .eq("assigned_agent", "pickle").eq("status", "in_progress").order("updated_at", { ascending: false }).limit(3),
      supabaseAdmin.from("work_items").select("id", { count: "exact", head: true })
        .eq("assigned_agent", "pickle").in("status", [...QUEUE_STATUSES]),
      supabaseAdmin.from("pending_approvals").select("id", { count: "exact", head: true })
        .eq("agent", "pickle").eq("status", "pending"),
    ]);
    const err = working.error ?? queue.error ?? approvals.error;
    if (err) throw err;
    return NextResponse.json({
      working: working.data ?? [],
      queue: queue.count ?? 0,
      approvals_pending: approvals.count ?? 0,
    });
  } catch (err) {
    console.error("pickle summary:", err);
    return NextResponse.json({ error: "Failed to load Dr. Pickle's work" }, { status: 500 });
  }
}
