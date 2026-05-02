import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("lead_activities")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json([], { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("lead_activities")
    .insert({ ...body, lead_id: id })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
