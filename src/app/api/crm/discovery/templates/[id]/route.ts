import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadTemplate } from "@/lib/discovery/server";
import { requirePermission } from "@/lib/requirePermission";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    const t = await loadTemplate(id);
    if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(t);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

const SectionId = z.string().regex(/^[a-z0-9_]{1,60}$/);
const ShowIf = z.object({ field: z.string(), in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() });
const ProjectType = z.enum(["content_social", "operations", "fundraising", "data_reporting", "other"]);

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  intro_text: z.string().trim().max(4000).nullable().optional(),
  estimated_minutes: z.number().int().min(1).max(120).nullable().optional(),
  sections: z.array(z.object({ id: SectionId, title: z.string().trim().min(1).max(200), intro: z.string().trim().max(2000).optional() })).max(40).optional(),
  // Full ordered list; replaces the template's items atomically.
  items: z.array(z.object({
    question_id: z.string().uuid(),
    section_id: SectionId,
    required: z.boolean().nullable().optional(),
    project_types: z.array(ProjectType).nullable().optional(),
    show_if: ShowIf.nullable().optional(),
  })).max(150).optional(),
  is_default: z.literal(true).optional(),
  archived: z.boolean().optional(),
}).superRefine((b, ctx) => {
  if (b.sections) {
    const ids = b.sections.map(s => s.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Section ids must be unique" });
  }
  if (b.items) {
    const qs = b.items.map(i => i.question_id);
    if (new Set(qs).size !== qs.length) ctx.addIssue({ code: "custom", message: "A question can only appear once in a template" });
  }
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const b = parsed.data;
  const crm = supabaseAdmin.schema("crm");

  const current = await loadTemplate(id).catch(() => null);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (b.archived !== undefined) {
    if (b.archived && current.is_default) return NextResponse.json({ error: "Make another template the default before archiving this one" }, { status: 409 });
    const { error } = await crm.from("discovery_templates").update({ archived_at: b.archived ? new Date().toISOString() : null }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (b.is_default) {
    if (current.archived_at && b.archived !== false) return NextResponse.json({ error: "Unarchive the template first" }, { status: 409 });
    // Partial unique index allows one default; clear the old one first.
    await crm.from("discovery_templates").update({ is_default: false }).eq("is_default", true).neq("id", id);
    const { error } = await crm.from("discovery_templates").update({ is_default: true }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const fields: Record<string, unknown> = {};
  for (const k of ["name", "description", "intro_text", "estimated_minutes", "sections"] as const) {
    if (b[k] !== undefined) fields[k] = b[k];
  }
  if (Object.keys(fields).length || b.items) {
    const sections = b.sections ?? current.sections;
    const items = b.items ?? current.items.map(i => ({
      question_id: i.question_id, section_id: i.section_id, required: i.required, project_types: i.project_types, show_if: i.show_if,
    }));
    const known = new Set(sections.map(s => s.id));
    const orphan = items.find(i => !known.has(i.section_id));
    if (orphan) return NextResponse.json({ error: "Every question must belong to one of the template's sections" }, { status: 400 });

    const { error } = await crm.rpc("discovery_template_save", { p_template: id, p_fields: fields, p_items: items });
    if (error) {
      const msg = error.code === "23505" ? "A template with that name already exists"
        : error.code === "23503" ? "One of the questions no longer exists" : error.message;
      return NextResponse.json({ error: msg }, { status: error.code === "23505" ? 409 : error.code === "23503" ? 400 : 500 });
    }
  }
  return NextResponse.json(await loadTemplate(id));
}
