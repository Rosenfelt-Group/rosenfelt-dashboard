import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
  ".eps", ".pdf", ".ai", ".psd", ".tiff", ".tif", ".bmp", ".ico",
]);

function isImagePath(path: string) {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("doc_registry")
    .select("id, name, path, description, category, updated_at, headings, last_indexed_at, chunk_count")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json((data ?? []).filter(d => !isImagePath(d.path ?? "")));
}
