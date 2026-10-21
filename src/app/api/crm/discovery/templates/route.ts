import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadTemplate } from "@/lib/discovery/server";
import { requirePermission } from "@/lib/requirePermission";

// GET /api/crm/discovery/templates[?archived=1]
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  let q = supabaseAdmin.schema("crm").from("discovery_templates")
    .select("id, name, description, intro_text, estimated_minutes, sections, is_default, archived_at, created_at, updated_at, items:discovery_template_items(count)")
    .order("is_default", { ascending: false }).order("name");
  if (req.nextUrl.searchParams.get("archived") !== "1") q = q.is("archived_at", null);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as unknown as (Record<string, unknown> & { items?: { count: number }[] })[];
  return NextResponse.json(rows.map(({ items, ...t }) => ({ ...t, item_count: items?.[0]?.count ?? 0 })));
}

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  duplicate_of: z.string().uuid().optional(),
});

// POST /api/crm/discovery/templates — blank, or a copy of an existing template.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const parsed = CreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const b = parsed.data;
  const crm = supabaseAdmin.schema("crm");

  const source = b.duplicate_of ? await loadTemplate(b.duplicate_of) : null;
  if (b.duplicate_of && !source) return NextResponse.json({ error: "Template to copy not found" }, { status: 404 });

  const { data: t, error } = await crm.from("discovery_templates").insert({
    name: b.name,
    description: b.description || source?.description || null,
    intro_text: source?.intro_text ?? null,
    estimated_minutes: source?.estimated_minutes ?? null,
    sections: source?.sections ?? [{ id: "general", title: "Questions" }],
  }).select("id").single();
  if (error) {
    const msg = error.code === "23505" ? "A template with that name already exists" : error.message;
    return NextResponse.json({ error: msg }, { status: error.code === "23505" ? 409 : 500 });
  }

  if (source?.items.length) {
    const { error: ie } = await crm.from("discovery_template_items").insert(source.items.map(i => ({
      template_id: t.id, question_id: i.question_id, position: i.position, section_id: i.section_id,
      required: i.required ?? null, project_types: i.project_types ?? null, show_if: i.show_if ?? null,
    })));
    if (ie) {
      await crm.from("discovery_templates").delete().eq("id", t.id);
      return NextResponse.json({ error: ie.message }, { status: 500 });
    }
  }
  return NextResponse.json(await loadTemplate(t.id), { status: 201 });
}
