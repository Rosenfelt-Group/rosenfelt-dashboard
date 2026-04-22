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
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const cause = e instanceof Error && (e as any).cause instanceof Error
      ? (e as any).cause.message
      : String((e as any)?.cause ?? "");
    return NextResponse.json({ error: `${msg}: ${cause}` }, { status: 502 });
  }
}
