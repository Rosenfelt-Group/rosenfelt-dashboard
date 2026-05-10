import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const maxDuration = 10;

function verifySignature(secret: string, body: string, sig: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 500 });

  const body = await req.text();
  const sig = req.headers.get("x-hub-signature-256") ?? "";

  if (!verifySignature(secret, body, sig)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const event = req.headers.get("x-github-event");
  if (event !== "workflow_run") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const payload = JSON.parse(body);
  const run = payload.workflow_run;
  const repo: string = payload.repository?.name ?? "unknown";

  const { error } = await supabaseAdmin.from("github_run_log").upsert(
    {
      source: "github",
      repo,
      workflow_name: run.name,
      external_id: String(run.id),
      status: run.status,
      conclusion: run.conclusion ?? null,
      branch: run.head_branch,
      triggered_by: run.actor?.login ?? null,
      run_url: run.html_url,
      started_at: run.run_started_at ?? null,
      completed_at: run.status === "completed" ? run.updated_at : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "source,repo,external_id" }
  );

  if (error) {
    console.error("github_run_log upsert failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
