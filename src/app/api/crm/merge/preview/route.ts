import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { PreviewQuery, mergeErrorResponse, type MergePreview } from "@/lib/crm/merge";

/**
 * GET /api/crm/merge/preview?kind=business|contact|lead&keep_id=<uuid>&merge_id=<uuid>
 *   -> MergePreview: both rows, one entry per mergeable field (values side by side, the default
 *   choice, and whether it is locked), counts of the rows that would move per referencing column,
 *   unique collisions and warnings. Changes nothing.
 */
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const sp = req.nextUrl.searchParams;
  const parsed = PreviewQuery.safeParse({ kind: sp.get("kind"), keep_id: sp.get("keep_id"), merge_id: sp.get("merge_id") });
  if (!parsed.success) return NextResponse.json({ error: "kind, keep_id and merge_id are required" }, { status: 400 });

  const { data, error } = await supabaseAdmin.schema("crm").rpc("merge_preview", {
    p_kind: parsed.data.kind, p_keep: parsed.data.keep_id, p_merge: parsed.data.merge_id,
  });
  if (error) return mergeErrorResponse(error);
  return NextResponse.json(data as MergePreview);
}
