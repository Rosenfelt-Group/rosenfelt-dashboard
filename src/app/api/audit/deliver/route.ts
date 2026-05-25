import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(COOKIE_NAME)?.value;
    const session = token ? await verifySessionToken(token) : null;
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 },
      );
    }
    const reviewer = session.username;

    const body = await req.json().catch(() => ({}));
    const approvalId = typeof body?.approval_id === "string" ? body.approval_id : null;
    if (!approvalId) {
      return NextResponse.json({ ok: false, error: "approval_id required" }, { status: 400 });
    }

    const { data: approval, error: fetchError } = await supabaseAdmin
      .from("pending_approvals")
      .select("id, agent, action_type, status, title, payload")
      .eq("id", approvalId)
      .single();

    if (fetchError || !approval) {
      return NextResponse.json({ ok: false, error: "Approval not found" }, { status: 404 });
    }
    if (approval.action_type !== "stack_audit_report") {
      return NextResponse.json(
        { ok: false, error: "Only stack_audit_report approvals can be sent here" },
        { status: 400 },
      );
    }
    if (approval.status !== "pending") {
      return NextResponse.json(
        { ok: false, error: `Approval already ${approval.status}` },
        { status: 409 },
      );
    }

    const avUrl = process.env.AVERY_AGENT_URL;
    const secret = process.env.AVERY_WEBHOOK_SECRET || process.env.JORDAN_WEBHOOK_SECRET;
    if (!avUrl || !secret) {
      await supabaseAdmin.from("workflow_logs").insert({
        workflow_name: "Dashboard Stack Audit Send",
        agent: "avery",
        trigger_text: approval.title ?? `approval ${approvalId}`,
        status: "error",
        error_message: "Missing AVERY_AGENT_URL or webhook secret",
      });
      return NextResponse.json(
        { ok: false, error: "Server config missing AVERY_AGENT_URL or webhook secret" },
        { status: 500 },
      );
    }

    let deliverDetail: string;
    let deliverOk = false;
    try {
      const res = await fetch(`${avUrl}/deliver-audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
        body: JSON.stringify({ approval_id: approval.id, payload: approval.payload }),
      });
      deliverOk = res.ok;
      deliverDetail = res.ok
        ? `audit send triggered for ${(approval.payload as { contact_email?: string } | null)?.contact_email ?? "unknown"} by ${reviewer}`
        : `avery returned HTTP ${res.status}`;
    } catch (e) {
      deliverDetail = e instanceof Error ? e.message : "deliver-audit call failed";
    }

    if (deliverOk) {
      await supabaseAdmin
        .from("pending_approvals")
        .update({
          status: "approved",
          reviewed_by: reviewer,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", approvalId);
    }

    await supabaseAdmin.from("workflow_logs").insert({
      workflow_name: "Dashboard Stack Audit Send",
      agent: "avery",
      trigger_text: approval.title ?? `approval ${approvalId}`,
      status: deliverOk ? "success" : "error",
      ...(deliverOk ? {} : { error_message: deliverDetail }),
    });

    return NextResponse.json({ ok: deliverOk, detail: deliverDetail });
  } catch (err) {
    console.error("audit/deliver error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 },
    );
  }
}
