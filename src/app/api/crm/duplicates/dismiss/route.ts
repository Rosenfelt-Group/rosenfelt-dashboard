import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { DismissBody, mergeErrorResponse } from "@/lib/crm/merge";

/**
 * POST /api/crm/duplicates/dismiss {kind, a_id, b_id, note?} -> {kind, id_a, id_b}
 *   "Not a duplicate": hides the pair (either order) from /api/crm/duplicates. Idempotent.
 */
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const parsed = DismissBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const { kind, a_id, b_id, note } = parsed.data;

  const { data, error } = await supabaseAdmin.schema("crm").rpc("dismiss_duplicate", {
    p_kind: kind, p_a: a_id, p_b: b_id, p_by: guard.username, p_note: note ?? null,
  });
  if (error) return mergeErrorResponse(error);
  return NextResponse.json(data);
}
