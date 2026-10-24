import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { parseTrashTarget } from "@/lib/crm/trash";
import { trashRpc } from "@/lib/crm/trash-server";

type Ctx = { params: Promise<{ kind: string; id: string }> };

// DELETE /api/crm/trash/:kind/:id -> PurgeResult. Removes a Trash item for good now (crm.purge_deleted).
// 409 TR003 when it is not in Trash; 409 TR006 when live records still point at it.
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const parsed = parseTrashTarget(await params);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  return trashRpc("purge_deleted", { p_kind: parsed.value.kind, p_id: parsed.value.id }, { TR003: "Not in Trash" });
}
