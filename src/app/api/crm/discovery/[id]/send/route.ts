import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { finalizeSend } from "@/lib/discovery/send";
import { emailInvite, EmailSchema } from "@/lib/discovery/email";
import { isValidEmail } from "@/lib/email";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ email: EmailSchema.optional() });

// POST /api/crm/discovery/:id/send — freeze the draft's questionnaire and mark it sent, then
// optionally email the link. An email failure never undoes the send; it's reported alongside it.
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const email = parsed.data.email;
  if (email && !isValidEmail(email.to)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  const result = await finalizeSend(id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  if (!email) return NextResponse.json({ ok: true, link: result.link });

  const out = await emailInvite(result.inviteId, { to: email.to, firstName: email.firstName || undefined });
  return NextResponse.json({
    ok: true, link: result.link,
    email: out.sent ? { sent: true, id: out.id } : { sent: false, error: out.error },
  });
}
