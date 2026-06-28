import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const ALLOWED_CREATE = new Set([
  "name", "url", "priority_tier", "cost", "complexity",
  "status", "date_completed", "notes", "is_candidate", "source",
]);

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("directories")
    .select("*")
    .order("priority_tier", { ascending: true })
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const insert: Record<string, unknown> = {};
  for (const key of ALLOWED_CREATE) {
    if (key in body) insert[key] = body[key];
  }
  if (!insert.name || !insert.url) {
    return NextResponse.json({ error: "name and url are required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("directories")
    .insert(insert)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
