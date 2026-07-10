import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { DocBulkPatchSchema } from "@/lib/doc-types";

// PATCH /api/docs/bulk  (requires manage_documents)
// Applies the same metadata patch to every id in the list, in one request.
export async function PATCH(req: NextRequest) {
  const guard = await requirePermission(req, "manage_documents");
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = DocBulkPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { ids, patch } = parsed.data;

  const { data, error } = await supabaseAdmin
    .from("doc_registry")
    .update(patch)
    .in("id", ids)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ updated: data?.length ?? 0 });
}
