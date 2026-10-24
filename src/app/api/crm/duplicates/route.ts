import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { MERGE_KINDS, candidatesFor, mergeErrorResponse, type DuplicateCandidate, type MergeKind } from "@/lib/crm/merge";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/crm/duplicates[?kind=business|contact|lead][&id=<uuid>][&include_dismissed=1]
 *   -> { items: DuplicateCandidate[] }, highest score first. `id` keeps the pairs that include that
 *   record (the banner on a record page). Records in Trash are never listed.
 */
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind");
  const id = sp.get("id");
  if (kind && !(MERGE_KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  if (id && !UUID.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const { data, error } = await supabaseAdmin.schema("crm").rpc("duplicate_candidates", {
    p_include_dismissed: sp.get("include_dismissed") === "1",
  });
  if (error) return mergeErrorResponse(error);
  let items = (data ?? []) as DuplicateCandidate[];
  if (kind) items = items.filter((r) => r.kind === (kind as MergeKind));
  if (id) items = candidatesFor(items, id);
  return NextResponse.json({ items });
}
