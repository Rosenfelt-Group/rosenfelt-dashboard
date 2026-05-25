import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "20");

  const { data, error } = await supabaseAdmin
    .from("regression_runs")
    .select(
      "id, run_at, triggered_by, triggered_by_user, overall_status, passed, failed, warnings, total_checks, duration_ms, summary",
    )
    .order("run_at", { ascending: false })
    .limit(Math.min(limit, 100));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
