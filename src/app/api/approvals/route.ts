import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const maxDuration = 60;

// Sam action routing table — keyed by action_type
const SAM_ROUTES: Record<string, string> = {
  sam_send_invoice:       "/execute/send_invoice",
  sam_send_email:         "/execute/send_email",
  sam_record_transaction: "/execute/record_transaction",
  sam_issue_refund:       "/execute/issue_refund",
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const history = searchParams.get("history") === "true";

    let query = supabaseAdmin
      .from("pending_approvals")
      .select("*")
      .order("created_at", { ascending: false });

    if (!history) query = query.eq("status", "pending");

    const { data, error } = await query.limit(200);
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("Approvals error:", err);
    return NextResponse.json([], { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, status, revision_notes } = body;

    if (!id || !["approved", "rejected", "revision_requested"].includes(status)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const reviewer = req.headers.get("x-user-name") ?? null;

    const { data: approval, error: fetchError } = await supabaseAdmin
      .from("pending_approvals")
      .select("id, agent, action_type, title, payload")
      .eq("id", id)
      .single();

    if (fetchError) throw fetchError;

    const isPublishPost = approval?.agent === "avery" && approval?.action_type === "publish_post";
    const isStackAudit  = approval?.agent === "avery" && approval?.action_type === "stack_audit_report";
    const ideaId = approval?.payload?.idea_id as string | undefined;
    const postId = approval?.payload?.post_id as number | undefined;
    const avUrl  = process.env.AVERY_AGENT_URL;
    const secret = process.env.AVERY_WEBHOOK_SECRET || process.env.JORDAN_WEBHOOK_SECRET;

    // Human gate: publish / send-deliverable requires an identified reviewer
    if (status === "approved" && (isPublishPost || isStackAudit) && !reviewer) {
      return NextResponse.json(
        { error: "Approval blocked: no human reviewer on record" },
        { status: 403 },
      );
    }

    // Write approval status + audit fields
    const updatePayload: Record<string, unknown> = { status };
    if (status === "approved" || status === "rejected") {
      updatePayload.reviewed_by = reviewer;
      updatePayload.reviewed_at = new Date().toISOString();
    }
    const { error: updateError } = await supabaseAdmin
      .from("pending_approvals")
      .update(updatePayload)
      .eq("id", id);
    if (updateError) throw updateError;

    // ── APPROVED → publish ───────────────────────────────────────────────────
    if (status === "approved" && isPublishPost) {
      if (!avUrl || !secret || typeof postId !== "number") {
        await supabaseAdmin.from("workflow_logs").insert({
          workflow_name: "Dashboard Publish Gate",
          agent: "avery",
          trigger_text: approval.title ?? `approval ${id}`,
          status: "error",
          error_message: "Missing AVERY_AGENT_URL, webhook secret, or payload.post_id",
        });
        return NextResponse.json({ success: true, publish: { ok: false, detail: "config missing" } });
      }

      let publishResult: { ok: boolean; detail: string };
      try {
        const res = await fetch(`${avUrl}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
          body: JSON.stringify({ post_id: postId, idea_id: ideaId, approval_id: approval.id }),
        });
        publishResult = {
          ok: res.ok,
          detail: res.ok
            ? `published post_id=${postId} by ${reviewer}`
            : `avery returned HTTP ${res.status}`,
        };
        if (res.ok && typeof ideaId === "string") {
          await supabaseAdmin.from("content_ideas").update({ status: "published" }).eq("id", ideaId);
        }
      } catch (e) {
        publishResult = { ok: false, detail: e instanceof Error ? e.message : "publish call failed" };
      }

      await supabaseAdmin.from("workflow_logs").insert({
        workflow_name: "Dashboard Publish Gate",
        agent: "avery",
        trigger_text: approval.title ?? `approval ${id}`,
        status: publishResult.ok ? "success" : "error",
        ...(publishResult.ok ? {} : { error_message: publishResult.detail }),
      });

      return NextResponse.json({ success: true, publish: publishResult });
    }

    // ── APPROVED → deliver Stack Audit PDF via Avery /deliver-audit ─────────
    if (status === "approved" && isStackAudit) {
      if (!avUrl || !secret) {
        await supabaseAdmin.from("workflow_logs").insert({
          workflow_name: "Dashboard Stack Audit Gate",
          agent: "avery",
          trigger_text: approval.title ?? `approval ${id}`,
          status: "error",
          error_message: "Missing AVERY_AGENT_URL or webhook secret",
        });
        return NextResponse.json({ success: true, deliver: { ok: false, detail: "config missing" } });
      }

      let deliverResult: { ok: boolean; detail: string };
      try {
        const res = await fetch(`${avUrl}/deliver-audit`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
          body: JSON.stringify({
            approval_id: approval.id,
            payload: approval.payload,
          }),
        });
        deliverResult = {
          ok: res.ok,
          detail: res.ok
            ? `audit delivery triggered for ${approval.payload?.contact_email} by ${reviewer}`
            : `avery returned HTTP ${res.status}`,
        };
      } catch (e) {
        deliverResult = { ok: false, detail: e instanceof Error ? e.message : "deliver-audit call failed" };
      }

      await supabaseAdmin.from("workflow_logs").insert({
        workflow_name: "Dashboard Stack Audit Gate",
        agent: "avery",
        trigger_text: approval.title ?? `approval ${id}`,
        status: deliverResult.ok ? "success" : "error",
        ...(deliverResult.ok ? {} : { error_message: deliverResult.detail }),
      });

      return NextResponse.json({ success: true, deliver: deliverResult });
    }

    // ── REJECTED → reset idea to queued ─────────────────────────────────────
    if (status === "rejected" && isPublishPost && typeof ideaId === "string") {
      await supabaseAdmin
        .from("content_ideas")
        .update({ status: "queued", revision_notes: null })
        .eq("id", ideaId);
    }

    // ── REVISION REQUESTED → update idea + trigger Avery rewrite ────────────
    if (status === "revision_requested" && isPublishPost) {
      if (typeof ideaId === "string") {
        await supabaseAdmin
          .from("content_ideas")
          .update({ status: "revision_needed", revision_notes: revision_notes ?? null })
          .eq("id", ideaId);
      }
      if (avUrl && secret && typeof postId === "number" && ideaId) {
        fetch(`${avUrl}/revise`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
          body: JSON.stringify({ idea_id: ideaId, post_id: postId, revision_notes }),
        }).catch(err => console.error("Avery /revise call failed:", err));
      }
    }

    // ── SAM approved actions ─────────────────────────────────────────────────
    if (status === "approved" && approval?.agent === "sam" && !reviewer) {
      return NextResponse.json({ error: "Sam action blocked: no human approval on record" }, { status: 403 });
    }

    if (status === "approved" && approval?.agent === "sam") {
      const samEndpoint = SAM_ROUTES[approval.action_type ?? ""];
      const samUrl = process.env.SAM_AGENT_URL;
      const samSecret = process.env.SAM_WEBHOOK_SECRET || process.env.JORDAN_WEBHOOK_SECRET;

      if (!samEndpoint || !samUrl || !samSecret) {
        await supabaseAdmin.from("workflow_logs").insert({
          workflow_name: "Dashboard Sam Gate",
          agent: "sam",
          trigger_text: approval.title ?? `approval ${id}`,
          status: "error",
          error_message: !samUrl
            ? "SAM_AGENT_URL not configured"
            : !samEndpoint
            ? `unknown action_type: ${approval.action_type}`
            : "SAM_WEBHOOK_SECRET not configured",
        });
        return NextResponse.json({ success: true, execute: { ok: false, detail: "config missing" } });
      }

      let executeResult: { ok: boolean; detail: string };
      try {
        const res = await fetch(`${samUrl}${samEndpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Webhook-Secret": samSecret },
          body: JSON.stringify({ approval_id: id }),
        });
        const resBody = await res.json().catch(() => ({}));
        executeResult = {
          ok: res.ok,
          detail: res.ok
            ? (resBody.detail ?? `executed by ${reviewer}`)
            : `sam returned HTTP ${res.status}: ${resBody.detail ?? ""}`,
        };
      } catch (e) {
        executeResult = { ok: false, detail: e instanceof Error ? e.message : "execute call failed" };
      }

      await supabaseAdmin.from("workflow_logs").insert({
        workflow_name: "Dashboard Sam Gate",
        agent: "sam",
        trigger_text: approval.title ?? `approval ${id}`,
        status: executeResult.ok ? "success" : "error",
        ...(executeResult.ok ? {} : { error_message: executeResult.detail }),
      });

      return NextResponse.json({ success: true, execute: executeResult });
    }

    // ── PATCH REMEDIATION approved → Jordan /patch/apply (dry-run unless enabled on Jordan) ──
    if (status === "approved" && approval?.agent === "casey" && approval?.action_type === "patch_remediation") {
      if (!reviewer) {
        return NextResponse.json({ error: "Patch apply blocked: no human reviewer on record" }, { status: 403 });
      }
      const jUrl = process.env.JORDAN_API_URL;
      const jSecret = process.env.JORDAN_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET;
      if (!jUrl || !jSecret) {
        await supabaseAdmin.from("workflow_logs").insert({
          workflow_name: "Dashboard Patch Apply Gate",
          agent: "jordan",
          trigger_text: approval.title ?? `approval ${id}`,
          status: "error",
          error_message: !jUrl ? "JORDAN_API_URL not configured" : "JORDAN_WEBHOOK_SECRET not configured",
        });
        return NextResponse.json({ success: true, apply: { ok: false, detail: "config missing" } });
      }

      let applyResult: { ok: boolean; detail: string };
      try {
        const selectedItems = Array.isArray(body.selected_items) ? body.selected_items : undefined;
        const res = await fetch(`${jUrl}/patch/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Webhook-Secret": jSecret },
          body: JSON.stringify({ approval_id: id, reviewer, selected_items: selectedItems, dry_run: false }),
        });
        const resBody = await res.json().catch(() => ({}));
        applyResult = {
          ok: res.ok,
          detail: res.ok
            ? (resBody.dry_run ? `dry-run recorded (${resBody.items} item(s))` : `apply ${resBody.status ?? "done"}`)
            : `jordan returned HTTP ${res.status}`,
        };
      } catch (e) {
        applyResult = { ok: false, detail: e instanceof Error ? e.message : "apply call failed" };
      }

      await supabaseAdmin.from("workflow_logs").insert({
        workflow_name: "Dashboard Patch Apply Gate",
        agent: "jordan",
        trigger_text: approval.title ?? `approval ${id}`,
        status: applyResult.ok ? "success" : "error",
        ...(applyResult.ok ? {} : { error_message: applyResult.detail }),
      });

      return NextResponse.json({ success: true, apply: applyResult });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Approval update error:", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
