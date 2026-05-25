import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

export const maxDuration = 30;

/**
 * Re-fire the Avery /deliver-audit pipeline for an already-approved
 * Stack Audit. Looks up the most recent approved pending_approvals row
 * linked to this work_item and calls Avery with the same payload.
 *
 * Used by the "Resend audit" button on the work item detail header.
 * Requires a signed-in user; the action is recorded in workflow_logs
 * with the resender's name.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id: workItemId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(workItemId)) {
    return NextResponse.json({ error: "Invalid work item id" }, { status: 400 });
  }

  // Find the most recent approved stack_audit approval linked to this
  // work item. Filter by payload->>work_item_id (JSONB string match).
  const { data: approvals, error: fetchErr } = await supabaseAdmin
    .from("pending_approvals")
    .select("id, status, payload, title")
    .eq("action_type", "stack_audit_report")
    .eq("payload->>work_item_id", workItemId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (fetchErr) {
    return NextResponse.json(
      { error: "Lookup failed", detail: fetchErr.message },
      { status: 500 },
    );
  }

  const approval = approvals?.[0];
  if (!approval) {
    return NextResponse.json(
      { error: "No Stack Audit approval found for this work item" },
      { status: 404 },
    );
  }
  if (approval.status !== "approved") {
    return NextResponse.json(
      {
        error: `Approval is ${approval.status}. Use Send Audit to Client on the approval card instead of Resend.`,
      },
      { status: 409 },
    );
  }

  const avUrl = process.env.AVERY_AGENT_URL;
  const secret = process.env.AVERY_WEBHOOK_SECRET || process.env.JORDAN_WEBHOOK_SECRET;
  if (!avUrl || !secret) {
    return NextResponse.json({ error: "Server config missing" }, { status: 500 });
  }

  let deliverOk = false;
  let deliverDetail: string;
  try {
    const res = await fetch(`${avUrl}/deliver-audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
      body: JSON.stringify({ approval_id: approval.id, payload: approval.payload }),
    });
    deliverOk = res.ok;
    const email = (approval.payload as { contact_email?: string } | null)?.contact_email ?? "unknown";
    deliverDetail = res.ok
      ? `resent to ${email} by ${session.username}`
      : `avery returned HTTP ${res.status}`;
  } catch (e) {
    deliverDetail = e instanceof Error ? e.message : "deliver-audit call failed";
  }

  await supabaseAdmin.from("workflow_logs").insert({
    workflow_name: "Dashboard Stack Audit Resend",
    agent: "avery",
    trigger_text: approval.title ?? `approval ${approval.id}`,
    status: deliverOk ? "success" : "error",
    ...(deliverOk ? {} : { error_message: deliverDetail }),
  });

  return NextResponse.json({ ok: deliverOk, detail: deliverDetail });
}
