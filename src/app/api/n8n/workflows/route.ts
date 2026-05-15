import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabaseAdmin
      .from("workflow_logs")
      .select("id, created_at, workflow_name, agent, status, error_message, duration_ms")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(300);

    if (error) throw error;

    const rows = (data ?? []) as {
      id: string; created_at: string; workflow_name: string;
      agent: string | null; status: string; error_message?: string; duration_ms?: number;
    }[];

    // Group by workflow_name for summary
    const byWorkflow = new Map<string, {
      workflow_name: string; runs: number; errors: number;
      last_run: string; last_status: string; avg_duration_ms: number | null;
    }>();

    for (const row of rows) {
      const name = row.workflow_name ?? "Unknown";
      const existing = byWorkflow.get(name);
      const dur = row.duration_ms ?? null;
      if (!existing) {
        byWorkflow.set(name, {
          workflow_name: name,
          runs: 1,
          errors: row.status === "error" ? 1 : 0,
          last_run: row.created_at,
          last_status: row.status,
          avg_duration_ms: dur,
        });
      } else {
        existing.runs++;
        if (row.status === "error") existing.errors++;
        if (dur !== null) {
          existing.avg_duration_ms = existing.avg_duration_ms === null
            ? dur
            : Math.round((existing.avg_duration_ms + dur) / 2);
        }
      }
    }

    const workflows = Array.from(byWorkflow.values())
      .sort((a, b) => new Date(b.last_run).getTime() - new Date(a.last_run).getTime());

    // Most recent 50 individual runs
    const recent = rows.slice(0, 50);

    return NextResponse.json({ workflows, recent });
  } catch (err) {
    console.error("n8n workflows error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
