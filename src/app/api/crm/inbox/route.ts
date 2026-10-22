import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/requirePermission";
import { InboxError, listInbox, resolveUnmatched } from "@/lib/crm/inbox";

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ items: await listInbox() });
  } catch (e) {
    console.error("inbox list failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

const str = z.string().trim().max(2000);
const bodySchema = z
  .object({
    unmatched_id: z.string().uuid(),
    contact_id: z.string().uuid().optional(),
    create: z.object({ email: str.email(), name: str.optional(), org: str.optional() }).optional(),
  })
  .refine((b) => !!b.contact_id !== !!b.create, { message: "Provide exactly one of contact_id or create" });

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  try {
    return NextResponse.json(await resolveUnmatched(parsed.data));
  } catch (e) {
    if (e instanceof InboxError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("inbox resolve failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
