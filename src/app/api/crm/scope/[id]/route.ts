import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { ScopeSectionsSchema } from "@/lib/crm/scope-client-view";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const crm = supabaseAdmin.schema("crm");
  const { data: doc, error } = await crm.from("scope_documents").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: versions, error: vErr } = await crm.from("scope_versions").select("*")
    .eq("scope_document_id", id).order("version_no", { ascending: false });
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
  return NextResponse.json({ document: doc, versions: versions ?? [] });
}

const PatchSchema = z.object({
  sections: ScopeSectionsSchema,
  change_note: z.string().trim().max(2000).optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid sections" }, { status: 400 });

  const crm = supabaseAdmin.schema("crm");
  const { data: doc } = await crm.from("scope_documents").select("id").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data, error } = await crm.rpc("create_scope_version_current", {
    p_doc_id: id,
    p_sections: parsed.data.sections,
    p_source: "brian",
    p_created_by: guard.username,
    p_change_note: parsed.data.change_note || null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ version_id: data });
}
