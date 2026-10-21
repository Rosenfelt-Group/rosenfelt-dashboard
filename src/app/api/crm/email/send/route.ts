import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/requireAdmin";
import { sendEmail } from "@/lib/email/executor";

export const maxDuration = 60;

const bodySchema = z.object({
  to: z.array(z.string().trim().email().max(320)).min(1).max(10),
  cc: z.array(z.string().trim().email().max(320)).max(10).optional(),
  subject: z.string().min(1).max(300),
  body_text: z.string().min(1).max(50_000),
  reply_to_email_message_id: z.string().uuid().optional(),
});

// Brian's direct compose: admin only, sends immediately as brian@rosably.com with no approval.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) }, { status: 400 });
  }
  try {
    const r = await sendEmail(parsed.data, "compose");
    return NextResponse.json({ gmail_message_id: r.gmail_message_id, thread_id: r.thread_id, ...(r.store_error ? { store_error: r.store_error } : {}) });
  } catch (e) {
    console.error("compose send failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Send failed" }, { status: 502 });
  }
}
