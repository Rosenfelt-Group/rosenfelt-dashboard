import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { loadToday } from "@/lib/crm/today";

// The CRM Today page: action queue, KPI tiles and pipeline value by stage.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json(await loadToday());
  } catch (e) {
    console.error("today failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
