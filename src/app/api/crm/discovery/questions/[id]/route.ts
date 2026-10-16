import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { QUESTION_SELECT } from "@/lib/discovery/server";
import { QuestionInputSchema, cleanQuestion } from "@/lib/discovery/bank";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/crm/discovery/questions/:id — edit a bank question. The key never
// changes (it's the answer id). Sent questionnaires are frozen snapshots, so
// edits only affect templates and drafts built afterwards.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const crm = supabaseAdmin.schema("crm");

  if (typeof body?.archived === "boolean" && Object.keys(body).length === 1) {
    const { data, error } = await crm.from("discovery_questions")
      .update({ archived_at: body.archived ? new Date().toISOString() : null }).eq("id", id).select(QUESTION_SELECT).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  }

  const parsed = QuestionInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const { data: current } = await crm.from("discovery_questions").select("type").eq("id", id).maybeSingle();
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = cleanQuestion(parsed.data);
  // Legacy types keep their shape; new types can't be switched to legacy ones.
  const legacy = (t: string) => t === "email" || t === "tool_rows";
  if ((legacy(current.type) || legacy(b.type)) && current.type !== b.type) {
    return NextResponse.json({ error: "Email and table questions can't change type" }, { status: 400 });
  }

  const { data, error } = await crm.from("discovery_questions")
    .update({ label: b.label, help: b.help || null, section: b.section, type: b.type, options: b.options, required: b.required, config: b.config })
    .eq("id", id).select(QUESTION_SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
