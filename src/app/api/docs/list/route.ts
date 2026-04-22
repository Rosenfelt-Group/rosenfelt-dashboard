import { NextResponse } from "next/server";

const JORDAN_API_URL = process.env.JORDAN_API_URL ?? "";
const JORDAN_WEBHOOK_SECRET = process.env.JORDAN_WEBHOOK_SECRET ?? "";

export async function GET() {
  if (!JORDAN_API_URL) {
    return NextResponse.json({ error: "JORDAN_API_URL not configured" }, { status: 503 });
  }
  try {
    const res = await fetch(`${JORDAN_API_URL}/docs/list`, {
      headers: { "X-Webhook-Secret": JORDAN_WEBHOOK_SECRET },
      cache: "no-store",
    });
    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return NextResponse.json({ status: res.status, url: `${JORDAN_API_URL}/docs/list`, data }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return NextResponse.json({ error: msg, url: `${JORDAN_API_URL}/docs/list` }, { status: 502 });
  }
}
