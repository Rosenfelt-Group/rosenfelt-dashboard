import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("research_briefs")
    .select("id, topic, research_type, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("research_briefs fetch error:", error);
    return NextResponse.json([], { status: 500 });
  }
  return NextResponse.json(data ?? []);
}
