import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Storage-backed files in known text formats are safe to decode as UTF-8 and
// inline as JSON `content`. Anything else (.pptx, .docx, images, etc.) is
// treated as binary — decoding arbitrary binary bytes as UTF-8 text produces
// mojibake, not a usable preview.
const TEXT_EXTENSIONS = [".md", ".markdown", ".txt", ".json", ".yml", ".yaml"];

function isTextExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

async function fetchFromStorage(storagePath: string): Promise<Response> {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const storageUrl = `${supabaseUrl}/storage/v1/object/documents/${storagePath}`;
  return fetch(storageUrl, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  });
}

// Serves a single doc body from the unified content store (doc_registry.content,
// populated by the SP1 indexer). Replaces the former proxy to Jordan's GET /docs.
// Falls back to Supabase Storage when doc_registry.content is null/empty.
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  const raw = req.nextUrl.searchParams.get("raw") === "1";
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

  // If inline content is present, return it directly (only ever populated for
  // text/markdown docs by the indexer — storage-backed binaries never have it).
  if (data.content != null && data.content !== "") {
    return NextResponse.json({ path: data.path, content: data.content });
  }

  // Fall back to Supabase Storage
  if (data.storage_path) {
    if (!isTextExtension(data.path)) {
      // Binary file: on the default (non-raw) request, point the client at a
      // download link instead of attempting to decode/inline the bytes. The
      // client re-requests this same route with ?raw=1 to get the actual
      // bytes streamed back with the right Content-Type/Content-Disposition.
      if (!raw) {
        return NextResponse.json({
          path: data.path,
          binary: true,
          downloadUrl: `/api/docs?path=${encodeURIComponent(path)}&raw=1`,
        });
      }
      try {
        const res = await fetchFromStorage(data.storage_path);
        if (!res.ok) {
          return NextResponse.json({ error: "Storage object not found" }, { status: 404 });
        }
        const buf = await res.arrayBuffer();
        const filename = data.path.split("/").pop() ?? "download";
        return new NextResponse(buf, {
          status: 200,
          headers: {
            "Content-Type": res.headers.get("content-type") ?? "application/octet-stream",
            "Content-Disposition": `attachment; filename="${filename}"`,
          },
        });
      } catch (fetchErr) {
        console.error("Storage fetch error:", fetchErr);
        return NextResponse.json({ error: "Failed to fetch from storage" }, { status: 500 });
      }
    }

    try {
      const res = await fetchFromStorage(data.storage_path);
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
