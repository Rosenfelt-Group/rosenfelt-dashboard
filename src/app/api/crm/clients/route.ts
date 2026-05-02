import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("clients")
    .select("*, business:businesses(*), contact:contacts(*)")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json([], { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("clients")
    .insert(body)
    .select("*, business:businesses(*), contact:contacts(*)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
