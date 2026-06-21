import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("research_categories")
    .select("id, name, sort_order")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("research_categories fetch error:", error);
    return NextResponse.json([], { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const name = (body?.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Determine next sort_order
  const { data: existing } = await supabaseAdmin
    .from("research_categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 1;

  const { data, error } = await supabaseAdmin
    .from("research_categories")
    .insert({ name, sort_order: nextOrder })
    .select("id, name, sort_order")
    .single();

  if (error) {
    console.error("research_categories insert error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
