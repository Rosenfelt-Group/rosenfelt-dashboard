import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

export const maxDuration = 30;

/**
 * Legacy proxy kept for backwards compatibility: takes an approval_id
 * and resolves to the linked work_item's deliverable PDF. The canonical
 * URL is /api/work/[id]/deliverable.pdf — new dashboard surfaces should
 * link there directly using work_item_id. This route exists so older
 * ApprovalCard renders and any external bookmarks still work.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const approvalId = req.nextUrl.searchParams.get("approval_id");
  if (!approvalId) {
    return NextResponse.json({ error: "approval_id required" }, { status: 400 });
  }

  const { data: approval, error } = await supabaseAdmin
    .from("pending_approvals")
    .select("agent, action_type, payload")
    .eq("id", approvalId)
    .single();

  if (error || !approval) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  }
  if (approval.action_type !== "stack_audit_report") {
    return NextResponse.json({ error: "Not a stack_audit_report approval" }, { status: 400 });
  }

  const workItemId = (approval.payload as { work_item_id?: string } | null)?.work_item_id;
  if (!workItemId) {
    return NextResponse.json(
      { error: "Approval is not linked to a work_item — cannot resolve deliverable" },
      { status: 404 },
    );
  }

  // Internal redirect to the canonical work-item deliverable proxy.
  // 302 keeps the session cookie attached and lets the browser open the
  // resolved URL directly (clean URL in the new tab).
  return NextResponse.redirect(
    new URL(`/api/work/${workItemId}/deliverable.pdf`, req.url),
    { status: 302 },
  );
}
