import { NextResponse } from "next/server";
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
