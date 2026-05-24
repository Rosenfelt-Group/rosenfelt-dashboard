import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const { id, docId } = await params;
  // Safety: only unlink if currently linked to THIS work item.
  // Never delete the doc_registry row — caller can re-link later.
  const { error } = await supabaseAdmin
    .from("doc_registry")
    .update({ work_item_id: null })
    .eq("id", docId)
    .eq("work_item_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
