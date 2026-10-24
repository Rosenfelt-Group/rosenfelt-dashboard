import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { parseTrashTarget } from "@/lib/crm/trash";
import { trashRpc } from "@/lib/crm/trash-server";

// GET /api/crm/delete/preview?kind=…&id=… -> DeletePreview
// What goes to Trash with the record, what stays, and whether Stripe services block it.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const sp = req.nextUrl.searchParams;
  const parsed = parseTrashTarget({ kind: sp.get("kind") ?? undefined, id: sp.get("id") ?? undefined });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  return trashRpc("delete_preview", { p_kind: parsed.value.kind, p_id: parsed.value.id });
}
