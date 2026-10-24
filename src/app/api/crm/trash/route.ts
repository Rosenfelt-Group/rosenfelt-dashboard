import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { TRASH_RETENTION_DAYS } from "@/lib/crm/trash";
import { trashRpc } from "@/lib/crm/trash-server";

// GET /api/crm/trash -> TrashItem[] (top-level deleted items, newest first)
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  return trashRpc("trash_items", { p_retention: `${TRASH_RETENTION_DAYS} days` });
}
