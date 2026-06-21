import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Serves a single doc body from the unified content store (doc_registry.content,
// populated by the SP1 indexer). Replaces the former proxy to Jordan's GET /docs.
// Falls back to Supabase Storage when doc_registry.content is null/empty.
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "path query parameter required" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin
    .from("doc_registry")
    .select("path, content, storage_path")
    .eq("path", path)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // If inline content is present, return it directly
  if (data.content != null && data.content !== "") {
    return NextResponse.json({ path: data.path, content: data.content });
  }

  // Fall back to Supabase Storage
  if (data.storage_path) {
    const supabaseUrl =
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const storageUrl = `${supabaseUrl}/storage/v1/object/documents/${data.storage_path}`;
    try {
      const res = await fetch(storageUrl, {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      });
      if (!res.ok) {
        return NextResponse.json({ error: "Storage object not found" }, { status: 404 });
      }
      const content = await res.text();
      return NextResponse.json({ path: data.path, content });
    } catch (fetchErr) {
      console.error("Storage fetch error:", fetchErr);
      return NextResponse.json({ error: "Failed to fetch from storage" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Document not found" }, { status: 404 });
}
