import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Image extensions hidden from the Documents library (they belong on
// the Images page). Note: .pdf is NOT included — PDFs are documents,
// not images, and Stack Audit deliverables are PDFs.
const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
  ".eps", ".ai", ".psd", ".tiff", ".tif", ".bmp", ".ico",
]);

function isImagePath(path: string) {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("doc_registry")
    .select(
      "id, name, path, description, category, updated_at, headings, last_indexed_at, chunk_count, work_item_id, work_items(title)"
    )
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // Flatten the joined work_items.title to a top-level work_item_title field
  // so the page doesn't need to know about the PostgREST nesting convention.
  const flattened = (data ?? [])
    .filter(d => !isImagePath(d.path ?? ""))
    .map(d => {
      const wi = (d as { work_items?: { title?: string } | null }).work_items;
      const work_item_title = wi?.title ?? null;
      const { work_items: _omit, ...rest } = d as Record<string, unknown>;
      return { ...rest, work_item_title };
    });
  return NextResponse.json(flattened);
}
