import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sessionUsername } from "@/lib/rooms/session-user";
import { removeObjects, type StorageObjectRef } from "@/lib/rooms/storage-cleanup";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

// DELETE — permanently delete a deliverable. Rows go first, atomically, in the database
// (rooms.delete_deliverable); then its files are removed. If file removal fails, the files are
// orphaned and unreachable, but no row ever points at a missing file.
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid deliverable id." }, { status: 400 });
  const actor = (await sessionUsername(req)) ?? "unknown";
  const { data, error } = await supabaseAdmin.schema("rooms").rpc("delete_deliverable", { p_deliverable: id, p_actor: actor });
  if (error) {
    if (error.code === "P0002") return NextResponse.json({ error: "Deliverable not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not delete this deliverable." }, { status: 500 });
  }
  const objects = (Array.isArray(data) ? data : []) as StorageObjectRef[];
  const { removed, failed } = await removeObjects(supabaseAdmin.storage, objects);
  if (failed > 0) console.error(`rooms: deliverable deleted; ${failed} storage object(s) could not be removed`);
  return NextResponse.json({ deleted: true, files_removed: removed, files_left: failed });
}
