import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const maxDuration = 10;

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("github_run_log")
    .select(
      "id, source, repo, workflow_name, external_id, status, conclusion, branch, triggered_by, run_url, started_at, completed_at"
    )
    .order("started_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
