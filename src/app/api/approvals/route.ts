import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const history = searchParams.get("history") === "true";

    const query = supabaseAdmin
      .from("pending_approvals")
      .select("*")
      .order("created_at", { ascending: false });

    if (!history) query.eq("status", "pending");

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
    const ideaId = approval?.payload?.idea_id as string | undefined;
    const postId = approval?.payload?.post_id as number | undefined;
    const avUrl  = process.env.AVERY_AGENT_URL;
    const secret = process.env.AVERY_WEBHOOK_SECRET || process.env.JORDAN_WEBHOOK_SECRET;

    // Human gate: publish requires an identified reviewer
    if (status === "approved" && isPublishPost && !reviewer) {
      return NextResponse.json(
        { error: "Publish blocked: no human approval on record" },
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

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Approval update error:", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
