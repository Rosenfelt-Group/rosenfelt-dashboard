import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

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

    const { data: approval, error: fetchError } = await supabaseAdmin
      .from("pending_approvals")
      .select("id, agent, action_type, payload")
      .eq("id", id)
      .single();

    if (fetchError) throw fetchError;

    const { error } = await supabaseAdmin
      .from("pending_approvals")
      .update({ status })
      .eq("id", id);

    if (error) throw error;

    // On approve for a blog-post publish, trigger Avery's /publish endpoint.
    // We await the publish so the UI reflects the actual outcome, but we isolate
    // its failures from the approval-status update that already succeeded.
    let publishResult: { ok: boolean; detail: string } | null = null;
    if (
      status === "approved" &&
      approval?.agent === "avery" &&
      approval?.action_type === "publish_post"
    ) {
      const avUrl = process.env.AVERY_AGENT_URL;
      const secret = process.env.AVERY_WEBHOOK_SECRET || process.env.JORDAN_WEBHOOK_SECRET;
      const postId = approval.payload?.post_id;

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
              idea_id: approval.payload?.idea_id,
              approval_id: approval.id,
            }),
          });
          publishResult = {
            ok: res.ok,
            detail: res.ok ? `published post_id=${postId}` : `avery returned HTTP ${res.status}`,
          };
        } catch (e) {
          publishResult = {
            ok: false,
            detail: e instanceof Error ? e.message : "avery publish call failed",
          };
        }
      }
    }

    return NextResponse.json({ success: true, publish: publishResult });
  } catch (err) {
    console.error("Approval update error:", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
