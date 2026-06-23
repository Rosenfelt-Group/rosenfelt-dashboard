import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

// Preview a patch_remediation apply without mutating anything: forces a dry-run
// on Jordan (records a 'dry_run' patch_remediations row) and leaves the approval
// pending. Body: { approval_id, selected_items? }.
export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const approvalId = body.approval_id;
  const selectedItems = Array.isArray(body.selected_items) ? body.selected_items : undefined;
  if (!approvalId) return NextResponse.json({ error: "approval_id required" }, { status: 400 });

  const jUrl = process.env.JORDAN_API_URL;
  const jSecret = process.env.JORDAN_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET;
  if (!jUrl || !jSecret) return NextResponse.json({ error: "Jordan not configured" }, { status: 500 });

  const reviewer = req.headers.get("x-user-name") ?? "dashboard";
  try {
    const res = await fetch(`${jUrl}/patch/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": jSecret },
      body: JSON.stringify({ approval_id: approvalId, reviewer, selected_items: selectedItems, dry_run: true }),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ ok: false, detail: e instanceof Error ? e.message : "dry-run call failed" }, { status: 502 });
  }
}
