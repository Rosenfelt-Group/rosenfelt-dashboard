import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const body = await req.json();
  // Only allow updating the category field
  const category = body?.category ?? null;

  const { data, error } = await supabaseAdmin
    .from("research_briefs")
    .update({ category })
    .eq("id", id)
    .select("id, category")
    .single();

  if (error) {
    console.error("research_briefs patch error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
