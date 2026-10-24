import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { parseTrashTarget } from "@/lib/crm/trash";
import { trashRpc } from "@/lib/crm/trash-server";

type Ctx = { params: Promise<{ kind: string; id: string }> };

// POST /api/crm/trash/:kind/:id/restore -> RestoreResult. Brings back the record and everything
// deleted with it. 409 TR003 when it is not in Trash; 409 TR005 when its parent is still in Trash.
export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const parsed = parseTrashTarget(await params);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  return trashRpc("restore_deleted", { p_kind: parsed.value.kind, p_id: parsed.value.id }, { TR003: "Not in Trash" });
}
