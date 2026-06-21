import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Read-only feed for the Patches status panel. Casey's patch_detection pipeline
// writes one patch_runs row per source/host/category per scan (no run-id column),
// so the panel clusters rows into scans client-side by run_at proximity.
export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "80");

  const { data, error } = await supabaseAdmin
    .from("patch_runs")
    .select("id, run_at, triggered_by, host, category, status, detected, summary, duration_ms")
    .order("run_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 300));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
