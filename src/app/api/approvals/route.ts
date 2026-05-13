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
    const { id, status } = await req.json();
    if (!id || !["approved", "rejected"].includes(status)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    // Reviewer identity is injected by auth middleware on every authenticated request
    const reviewer = req.headers.get("x-user-name") ?? null;

    const { data: approval, error: fetchError } = await supabaseAdmin
      .from("pending_approvals")
      .select("id, agent, action_type, title, payload")
      .eq("id", id)
      .single();

    if (fetchError) throw fetchError;

    // Guard: publish_post approvals require an identified human reviewer
    if (
      status === "approved" &&
      approval?.agent === "avery" &&
      approval?.action_type === "publish_post" &&
      !reviewer
    ) {
      return NextResponse.json(
        { error: "Publish blocked: no human approval on record" },
        { status: 403 }
      );
    }

    // Write status + reviewer audit fields atomically
    const updatePayload: Record<string, unknown> = { status };
    if (status === "approved") {
      updatePayload.reviewed_by = reviewer;
      updatePayload.reviewed_at = new Date().toISOString();
    }

    const { error: updateError } = await supabaseAdmin
      .from("pending_approvals")
      .update(updatePayload)
      .eq("id", id);

    if (updateError) throw updateError;

    // On approve for a blog-post publish, trigger Avery's /publish endpoint.
    // We await the publish so the UI reflects the actual outcome, but we isolate
    // its failures from the approval-status update that already succeeded.
    let publishResult: { ok: boolean; detail: string } | null = null;
    if (
      status === "approved" &&
      approval?.agent === "avery" &&
      approval?.action_type === "publish_post"
    ) {
      const avUrl  = process.env.AVERY_AGENT_URL;
      const secret = process.env.AVERY_WEBHOOK_SECRET || process.env.JORDAN_WEBHOOK_SECRET;
      const postId = approval.payload?.post_id;
      const ideaId = approval.payload?.idea_id;

      if (!avUrl || !secret || typeof postId !== "number") {
        publishResult = {
          ok: false,
          detail: "Missing AVERY_AGENT_URL, webhook secret, or payload.post_id",
        };
      } else {
        try {
          const res = await fetch(`${avUrl}/publish`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Webhook-Secret": secret,
            },
            body: JSON.stringify({
              post_id: postId,
              idea_id: ideaId,
              approval_id: approval.id,
            }),
          });
          publishResult = {
            ok: res.ok,
            detail: res.ok
              ? `published post_id=${postId} by ${reviewer}`
              : `avery returned HTTP ${res.status}`,
          };

          // Mirror publish outcome to content_ideas so the Content page reflects reality
          if (res.ok && typeof ideaId === "string") {
            await supabaseAdmin
              .from("content_ideas")
              .update({ status: "published" })
              .eq("id", ideaId);
          }
        } catch (e) {
          publishResult = {
            ok: false,
            detail: e instanceof Error ? e.message : "avery publish call failed",
          };
        }
      }

      // Audit log — always write regardless of publish outcome
      await supabaseAdmin.from("workflow_logs").insert({
        workflow_name: "Dashboard Publish Gate",
        agent:         "avery",
        trigger_text:  approval.title ?? `approval ${id}`,
        status:        publishResult.ok ? "success" : "error",
        ...(publishResult.ok ? {} : { error_message: publishResult.detail }),
      });
    }

    return NextResponse.json({ success: true, publish: publishResult });
  } catch (err) {
    console.error("Approval update error:", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
