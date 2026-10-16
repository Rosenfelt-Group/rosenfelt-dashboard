import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { QUESTION_SELECT } from "@/lib/discovery/server";
import { QuestionInputSchema, cleanQuestion, isCreatableType } from "@/lib/discovery/bank";
import { slugify } from "@/lib/discovery/snapshot";

// GET /api/crm/discovery/questions[?archived=1] — the question bank.
export async function GET(req: NextRequest) {
  let q = supabaseAdmin.schema("crm").from("discovery_questions").select(QUESTION_SELECT)
    .order("section").order("created_at");
  if (req.nextUrl.searchParams.get("archived") !== "1") q = q.is("archived_at", null);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/crm/discovery/questions — add a question to the bank.
export async function POST(req: NextRequest) {
  const parsed = QuestionInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const b = cleanQuestion(parsed.data);
  if (!isCreatableType(b.type)) return NextResponse.json({ error: "That question type can't be created" }, { status: 400 });

  const crm = supabaseAdmin.schema("crm");
  let key = b.key ?? slugify(b.label, 40);
  if (!/^[a-z]/.test(key)) key = `q_${key}`;
  // Keys are answer ids, so they must stay unique forever; suffix on collision.
  const { data: taken } = await crm.from("discovery_questions").select("key").like("key", `${key}%`);
  const used = new Set((taken ?? []).map(r => r.key as string));
  if (used.has(key)) {
    if (b.key) return NextResponse.json({ error: `A bank question already uses the key “${key}”` }, { status: 409 });
    let n = 2;
    while (used.has(`${key}_${n}`)) n++;
    key = `${key}_${n}`;
  }

  const { data, error } = await crm.from("discovery_questions")
    .insert({ key, label: b.label, help: b.help || null, section: b.section, type: b.type, options: b.options, required: b.required, config: b.config })
    .select(QUESTION_SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "23505" ? 409 : 500 });
  return NextResponse.json(data, { status: 201 });
}
