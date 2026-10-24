import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { MERGE_RPC, MergeBody, mergeErrorResponse, type MergeResult } from "@/lib/crm/merge";

/**
 * POST /api/crm/merge {kind: "business"|"contact"|"lead", keep_id, merge_id, fields?: {field: "keep"|"merge"|"both"}}
 *   -> MergeResult. Runs crm.merge_<kind>s in one transaction: everything linked to merge_id moves to
 *   keep_id, merge_id is deleted and redirects to keep_id. A field left out of `fields` keeps the
 *   surviving value (or fills it from the merged record when empty). Not undoable.
 */
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const parsed = MergeBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { kind, keep_id, merge_id, fields } = parsed.data;

  const { data, error } = await supabaseAdmin.schema("crm").rpc(MERGE_RPC[kind], {
    p_keep: keep_id, p_merge: merge_id, p_fields: fields ?? {}, p_by: guard.username,
  });
  if (error) return mergeErrorResponse(error);
  return NextResponse.json(data as MergeResult);
}
