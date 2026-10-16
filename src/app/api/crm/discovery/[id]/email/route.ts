import { NextRequest, NextResponse } from "next/server";
import { emailInvite, EmailSchema } from "@/lib/discovery/email";
import { isValidEmail } from "@/lib/email/gmail";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/crm/discovery/:id/email — (re)send the invite email for an already-sent questionnaire.
// Doesn't touch the frozen questions or the invite's status.
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = EmailSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success || !isValidEmail(parsed.data.to)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const out = await emailInvite(id, { to: parsed.data.to, firstName: parsed.data.firstName || undefined });
  if (!out.sent) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ ok: true, id: out.id });
}
