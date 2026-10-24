import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { getLiveBusiness, ResearchError } from "@/lib/research/org-research";

type Ctx = { params: Promise<{ id: string }> };

const BodySchema = z.object({ business_id: z.string().uuid("business_id must be a uuid") });

async function parse(req: NextRequest) {
  return BodySchema.safeParse(await req.json().catch(() => ({})));
}

/** Link a library brief to an organization, so it shows on that organization's Research tab. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const parsed = await parse(req);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const { business_id } = parsed.data;

  try {
    const { data: brief, error: bErr } = await supabaseAdmin.from("research_briefs")
      .select("id").eq("id", id).is("deleted_at", null).maybeSingle();
    if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
    if (!brief) return NextResponse.json({ error: "Brief not found" }, { status: 404 });
    if (!(await getLiveBusiness(business_id))) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

    const { error } = await supabaseAdmin.from("research_brief_links")
      .upsert({ brief_id: id, business_id, linked_by: guard.username }, { onConflict: "brief_id,business_id", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, brief_id: id, business_id }, { status: 201 });
  } catch (e) {
    if (e instanceof ResearchError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/** Unlink. The organization's "Use in scope" tick on this brief goes with the link (FK cascade). */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const parsed = await parse(req);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const { error } = await supabaseAdmin.from("research_brief_links")
    .delete().eq("brief_id", id).eq("business_id", parsed.data.business_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
