import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { docExt } from "@/lib/rooms/documents";
import { DOC_EXTS, isSafeDocFilename } from "@/lib/rooms/grant";
import { DOC_BUCKET } from "@/lib/rooms/doc-limits";
import { requirePermission } from "@/lib/requirePermission";

const FILE_RE = new RegExp(`^document\\.(?:${DOC_EXTS.join("|")})$`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET — a 60-second signed download URL for a document version (drafts included), dashboard only.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid version id." }, { status: 400 });
  const { data: v } = await supabaseAdmin.schema("rooms").from("deliverable_versions")
    .select("storage_prefix, source, manifest").eq("id", id).maybeSingle();
  const file = v?.manifest?.file;
  if (!v || v.source !== "upload" || typeof file !== "string" || !FILE_RE.test(file)) return NextResponse.json({ error: "Document not found." }, { status: 404 });
  const name = isSafeDocFilename(v.manifest.filename) && docExt(v.manifest.filename) === docExt(file) ? v.manifest.filename : file;
  const { data, error } = await supabaseAdmin.storage.from(DOC_BUCKET).createSignedUrl(`${v.storage_prefix}/${file}`, 60, { download: name });
  if (error || !data) return NextResponse.json({ error: "Could not create a download link." }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}
