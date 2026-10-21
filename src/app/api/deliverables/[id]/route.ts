import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sessionUsername } from "@/lib/rooms/session-user";
import { DeliverablePatchSchema } from "@/lib/rooms/schemas";
import { removeObjects, type StorageObjectRef } from "@/lib/rooms/storage-cleanup";
import { requirePermission } from "@/lib/requirePermission";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

// DELETE — permanently delete a deliverable. Rows go first, atomically, in the database
// (rooms.delete_deliverable); then its files are removed. If file removal fails, the files are
// orphaned and unreachable, but no row ever points at a missing file.
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

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

// PATCH — set or clear the deliverable's welcome message (plain text, shown in the room as text).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid deliverable id." }, { status: 400 });
  const parsed = DeliverablePatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin.schema("rooms").from("deliverables")
    .update({ welcome_message: parsed.data.welcome_message })
    .eq("id", id).select("id, welcome_message").maybeSingle();
  if (error) return NextResponse.json({ error: "Could not save the welcome message." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Deliverable not found." }, { status: 404 });
  return NextResponse.json(data);
}
