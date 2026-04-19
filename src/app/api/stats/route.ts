import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const [
      { count: pendingApprovals },
      { count: openTasks },
      { count: overdueTasks },
      { count: executionsToday },
      { count: errorsToday },
      { count: contentQueue },
    ] = await Promise.all([
      supabaseAdmin
        .from("pending_approvals")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      supabaseAdmin
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .in("status", ["open", "in_progress"]),
      supabaseAdmin
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .in("status", ["open", "in_progress"])
        .lt("due_date", now.toISOString().split("T")[0]),
      supabaseAdmin
        .from("workflow_logs")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startOfDay.toISOString()),
      supabaseAdmin
        .from("workflow_logs")
        .select("*", { count: "exact", head: true })
        .eq("status", "error")
        .gte("created_at", startOfDay.toISOString()),
      supabaseAdmin
        .from("content_ideas")
        .select("*", { count: "exact", head: true })
        .eq("status", "queued"),
    ]);

    return NextResponse.json({
      pending_approvals: pendingApprovals ?? 0,
      open_tasks: openTasks ?? 0,
      overdue_tasks: overdueTasks ?? 0,
      executions_today: executionsToday ?? 0,
      errors_today: errorsToday ?? 0,
      content_queue: contentQueue ?? 0,
    });
  } catch (err) {
    console.error("Stats error:", err);
    return NextResponse.json({ error: "Failed to load stats" }, { status: 500 });
  }
}
