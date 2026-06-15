import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const topic = (body.topic as string | undefined)?.trim();
  if (!topic) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }

  const AVERY_URL = process.env.AVERY_API_URL;
  if (!AVERY_URL) {
    return NextResponse.json({ error: "AVERY_API_URL not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(`${AVERY_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Run research brief on: ${topic}`,
        session_id: "dashboard_research_brian",
      }),
    });
    if (!res.ok) throw new Error(`Avery responded ${res.status}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("research trigger error:", err);
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
