import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const maxDuration = 10;

export async function POST(req: NextRequest) {
  const secret = process.env.JORDAN_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 500 });

  const incoming = req.headers.get("x-webhook-secret") ?? "";
  if (incoming !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { external_id, repo, status, conclusion, workflow_name, branch, triggered_by, started_at, completed_at } = body;

  if (!external_id || !repo || !status) {
    return NextResponse.json({ error: "external_id, repo, and status are required" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("github_run_log").upsert(
    {
      source: "vps",
      repo,
      workflow_name: workflow_name ?? "docker compose deploy",
      external_id,
      status,
      conclusion: conclusion ?? null,
      branch: branch ?? "main",
      triggered_by: triggered_by ?? "brian",
      run_url: null,
      started_at: started_at ?? null,
      completed_at: completed_at ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "source,repo,external_id" }
  );

  if (error) {
    console.error("vps deploy upsert failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
