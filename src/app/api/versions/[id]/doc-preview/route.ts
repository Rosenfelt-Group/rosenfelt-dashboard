import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { docExt } from "@/lib/rooms/documents";
import { DOC_EXTS, isSafeDocFilename, signDocGrant } from "@/lib/rooms/grant";
import { canPreviewDoc } from "@/lib/rooms/doc-limits";
import { requirePermission } from "@/lib/requirePermission";

const FILE_RE = new RegExp(`^document\\.(?:${DOC_EXTS.join("|")})$`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET — a preview URL (120 s grant on the preview host's inline /dp route) for a document version of any
// status. Dashboard only (the middleware requires a session). Office formats are download-only.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid version id." }, { status: 400 });
  const secret = process.env.ROOM_GRANT_SECRET;
  if (!secret) return NextResponse.json({ error: "ROOM_GRANT_SECRET is not configured" }, { status: 500 });
  const { data: v } = await supabaseAdmin.schema("rooms").from("deliverable_versions")
    .select("storage_prefix, source, manifest").eq("id", id).maybeSingle();
  const file = v?.manifest?.file;
  if (!v || v.source !== "upload" || typeof file !== "string" || !FILE_RE.test(file)) return NextResponse.json({ error: "Document not found." }, { status: 404 });
  const ext = docExt(file);
  if (!ext || !canPreviewDoc(ext)) return NextResponse.json({ error: "This file type can't be previewed. Download it instead." }, { status: 400 });
  const name = isSafeDocFilename(v.manifest.filename) && docExt(v.manifest.filename) === ext ? v.manifest.filename : file;
  let grant: string;
  try { grant = signDocGrant(`${v.storage_prefix}/${file}`, name, secret); }
  catch { return NextResponse.json({ error: "Could not create a preview link." }, { status: 500 }); }
  const base = (process.env.NEXT_PUBLIC_PREVIEW_URL ?? "https://preview.rosably.com").replace(/\/$/, "");
  return NextResponse.json({ url: `${base}/dp/${grant}` });
}
