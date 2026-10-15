import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { DocumentUploadSchema } from "@/lib/rooms/schemas";
import { docExt, sanitizeDocFilename } from "@/lib/rooms/documents";
import { DOC_TYPES } from "@/lib/rooms/grant";
import { DOC_BUCKET } from "@/lib/rooms/doc-limits";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES_MSG = "Allowed file types: PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), PNG, JPG, TXT, CSV, Markdown.";
type Ctx = { params: Promise<{ id: string }> };

// POST — prepare a document upload: resolve or create the document deliverable and return a signed
// upload URL. The browser sends the file straight to Storage (never through this function).
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const parsed = DocumentUploadSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const b = parsed.data;
  const filename = sanitizeDocFilename(b.filename);
  const ext = filename ? docExt(filename) : null;
  if (!filename || !ext) return NextResponse.json({ error: TYPES_MSG }, { status: 400 });

  const rooms = supabaseAdmin.schema("rooms");
  const { data: eng } = await rooms.from("engagements").select("id, status").eq("id", id).single();
  if (!eng) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  if (eng.status === "closed") return NextResponse.json({ error: "Engagement is closed" }, { status: 409 });

  let deliverableId: string;
  if (b.deliverable_id) {
    const { data: d } = await rooms.from("deliverables").select("id, kind")
      .eq("id", b.deliverable_id).eq("engagement_id", eng.id).maybeSingle();
    if (!d) return NextResponse.json({ error: "Deliverable not found in this engagement" }, { status: 404 });
    if (d.kind !== "document") return NextResponse.json({ error: "That deliverable is a prototype, not a document." }, { status: 409 });
    deliverableId = d.id;
  } else {
    const { data: d, error } = await rooms.from("deliverables")
      .insert({ engagement_id: eng.id, title: b.deliverable_title, kind: "document" }).select("id").single();
    if (error || !d) return NextResponse.json({ error: "Could not create the document." }, { status: 500 });
    deliverableId = d.id;
  }

  const uploadId = randomUUID();
  const path = `${eng.id}/${deliverableId}/${uploadId}/document.${ext}`;
  const { data, error } = await supabaseAdmin.storage.from(DOC_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: "Could not prepare the upload." }, { status: 500 });
  return NextResponse.json({
    deliverable_id: deliverableId, upload_id: uploadId, filename, signed_url: data.signedUrl, content_type: DOC_TYPES[ext],
  }, { status: 201 });
}
