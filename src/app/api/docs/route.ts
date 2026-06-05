import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Serves a single doc body from the unified content store (doc_registry.content,
// populated by the SP1 indexer). Replaces the former proxy to Jordan's GET /docs.
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "path query parameter required" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin
    .from("doc_registry")
    .select("path, content")
    .eq("path", path)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.content == null) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  return NextResponse.json({ path: data.path, content: data.content });
}
