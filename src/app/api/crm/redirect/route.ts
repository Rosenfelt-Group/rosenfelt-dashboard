import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { RedirectQuery, recordHref } from "@/lib/crm/merge";

/**
 * GET /api/crm/redirect?kind=business|contact|lead&id=<uuid>
 *   -> { kind, id, kept_id, href, merged_at, merged_by } when the record was merged away, else 404.
 *   Chains are already flattened, so kept_id is the record that exists now. For "Not found" pages.
 */
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const sp = req.nextUrl.searchParams;
  const parsed = RedirectQuery.safeParse({ kind: sp.get("kind"), id: sp.get("id") });
  if (!parsed.success) return NextResponse.json({ error: "kind and id are required" }, { status: 400 });
  const { kind, id } = parsed.data;

  const { data, error } = await supabaseAdmin.schema("crm").from("merge_redirects")
    .select("kept_id, merged_at, merged_by")
    .eq("kind", kind).eq("merged_id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No redirect" }, { status: 404 });
  return NextResponse.json({ kind, id, kept_id: data.kept_id, href: recordHref(kind, data.kept_id), merged_at: data.merged_at, merged_by: data.merged_by });
}
