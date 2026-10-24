import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { parseTrashTarget } from "@/lib/crm/trash";
import { softDelete } from "@/lib/crm/trash-server";

// POST /api/crm/delete {kind, id} -> SoftDeleteResult
// Moves the record to Trash with everything under it (crm.soft_delete). 409 TR001 (with `services`)
// when a business or client still has a live Stripe subscription; 409 TR003 when already in Trash.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const parsed = parseTrashTarget(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  return softDelete(parsed.value.kind, parsed.value.id, guard.username);
}
