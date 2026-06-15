import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const topic = (body.topic as string | undefined)?.trim();
  if (!topic) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }

  const AVERY_URL = process.env.AVERY_AGENT_URL;
  if (!AVERY_URL) {
    return NextResponse.json({ error: "AVERY_AGENT_URL not configured" }, { status: 503 });
  }

  const secret = process.env.AVERY_WEBHOOK_SECRET || process.env.JORDAN_WEBHOOK_SECRET;

  // Fire and forget — don't await
  fetch(`${AVERY_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": secret ?? "",
    },
    body: JSON.stringify({
      text: `Run research brief on: ${topic}`,
      chatId: "dashboard_research_brian",
    }),
  }).catch(err => console.error("research trigger error:", err));

  return NextResponse.json({ ok: true });
}
