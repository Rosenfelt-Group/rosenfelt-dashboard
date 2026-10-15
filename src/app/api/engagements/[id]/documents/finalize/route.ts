import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { DocumentFinalizeSchema } from "@/lib/rooms/schemas";
import { docExt, sanitizeDocFilename, sniffDocument, readHead } from "@/lib/rooms/documents";
import { DOC_BUCKET } from "@/lib/rooms/doc-limits";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

// POST — verify an uploaded object and add it as a draft version. Contents are sniffed here; size and
// MIME are checked again in the database (rooms.add_document_version) from Storage's own metadata.
// The object is deleted only on a definite refusal, never on an unknown error (a row might exist).
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const parsed = DocumentFinalizeSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const b = parsed.data;
  const filename = sanitizeDocFilename(b.filename);
  const ext = filename ? docExt(filename) : null;
  if (!filename || !ext) return NextResponse.json({ error: "This file type is not allowed." }, { status: 400 });

  const rooms = supabaseAdmin.schema("rooms");
  const { data: eng } = await rooms.from("engagements").select("id, status").eq("id", id).single();
  if (!eng) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  if (eng.status === "closed") return NextResponse.json({ error: "Engagement is closed" }, { status: 409 });
  const { data: d } = await rooms.from("deliverables").select("id, engagement_id, kind")
    .eq("id", b.deliverable_id).eq("engagement_id", id).maybeSingle();
  if (!d) return NextResponse.json({ error: "Deliverable not found in this engagement" }, { status: 404 });
  if (d.kind !== "document") return NextResponse.json({ error: "That deliverable is a prototype, not a document." }, { status: 409 });

  const uploadId = b.upload_id.toLowerCase();
  const path = `${d.engagement_id}/${d.id}/${uploadId}/document.${ext}`;
  const bucket = supabaseAdmin.storage.from(DOC_BUCKET);
  const refuse = async (error: string) => {
    await bucket.remove([path]).catch(() => undefined);
    return NextResponse.json({ error }, { status: 400 });
  };

  const dl = await bucket.download(path).asStream();
  if (dl.error || !dl.data) return NextResponse.json({ error: "The upload was not found. Please upload the file again." }, { status: 404 });
  const head = await readHead(dl.data as ReadableStream<Uint8Array>);
  if (!sniffDocument(ext, head)) return refuse(`This file's contents don't match its type (.${ext}). It was not added.`);

  const { data, error } = await rooms.rpc("add_document_version", {
    p_deliverable: d.id, p_upload: uploadId, p_ext: ext, p_filename: filename, p_change_summary: b.change_summary ?? null,
  });
  if (error) {
    // Duplicate finalize: the object backs an existing version, so it must NOT be deleted.
    if (error.code === "23505") return NextResponse.json({ error: "This upload was already added." }, { status: 409 });
    if (error.code === "P0001") return refuse("This file could not be added (it may be too large, the wrong type, or already added).");
    if (error.code === "P0002") return NextResponse.json({ error: "Deliverable not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not add this document. Try again." }, { status: 500 });
  }
  const row = (Array.isArray(data) ? data[0] : data) as { version_id: string; version_no: number } | null;
  if (!row) return NextResponse.json({ error: "Could not add this document. Try again." }, { status: 500 });
  return NextResponse.json({ version_id: row.version_id, version_no: row.version_no }, { status: 201 });
}
