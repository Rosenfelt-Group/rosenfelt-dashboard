import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/requirePermission";
import { resendEvent } from "@/lib/email/resend";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Body = z.object({
  to: z.string().trim().min(1).max(254).optional(),
  unblock: z.boolean().optional(),
});

// POST {to?, unblock?} — resend the email behind one problem, per its source (lib/email/resend).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission(req, "manage_email");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid event id." }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  try {
    const r = await resendEvent(id, { ...parsed.data, by: guard.username });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r);
  } catch (e) {
    console.error("email resend failed:", e);
    return NextResponse.json({ error: "Couldn't resend that. Please try again." }, { status: 500 });
  }
}
