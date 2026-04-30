import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const category = req.nextUrl.searchParams.get("category") ?? null;

  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc("search_doc_chunks", {
    query: q,
    p_category: category,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
