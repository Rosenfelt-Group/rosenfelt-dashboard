import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("tool_backlog")
      .select("id, claude_code_prompt")
      .eq("id", id)
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    console.error("Backlog detail GET error:", err);
    return NextResponse.json({ error: "Failed to load item" }, { status: 500 });
  }
}
