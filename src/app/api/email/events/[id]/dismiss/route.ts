import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { resolveEvents, logAction } from "@/lib/email/events";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST — mark one email problem as dismissed (no Postmark call).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission(req, "manage_email");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid event id." }, { status: 400 });
  let n: number;
  try {
    n = await resolveEvents({ id }, "dismissed", guard.username);
  } catch (e) {
    console.error("email dismiss failed:", e);
    return NextResponse.json({ error: "Couldn't save that. Please try again." }, { status: 500 });
  }
  if (n === 0) return NextResponse.json({ error: "That problem was not found or is already resolved." }, { status: 404 });
  await logAction({ action: "dismiss", eventId: id, by: guard.username });
  return NextResponse.json({ ok: true });
}
