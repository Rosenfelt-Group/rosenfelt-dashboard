import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    const since = new Date();
    since.setHours(since.getHours() - 24);

    const { data, error } = await supabaseAdmin
      .from("workflow_logs")
      .select("agent, status, created_at")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false });

    if (error) throw error;

    const agents = ["riley", "jordan", "avery"] as const;
    const summary = agents.map((agent) => {
      const rows = (data ?? []).filter((r) => r.agent === agent);
      const errors = rows.filter((r) => r.status === "error").length;
      const last = rows[0];
      return {
        agent,
        executions_24h: rows.length,
        errors_24h: errors,
        last_execution: last?.created_at ?? null,
        last_status: last?.status ?? null,
      };
    });

    return NextResponse.json(summary);
  } catch (err) {
    console.error("Agent status error:", err);
    return NextResponse.json([], { status: 500 });
  }
}
