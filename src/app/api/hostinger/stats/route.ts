import { NextResponse } from "next/server";

export const maxDuration = 15;

export async function GET() {
  const baseUrl = process.env.JORDAN_API_URL;
  const secret  = process.env.JORDAN_WEBHOOK_SECRET ?? "";
  if (!baseUrl) return NextResponse.json({ error: "not configured" }, { status: 500 });

  try {
    const res = await fetch(`${baseUrl}/hostinger-stats`, {
      headers: { "X-Webhook-Secret": secret },
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ error: `Jordan ${res.status}` }, { status: 502 });
    return NextResponse.json(await res.json());
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unreachable" },
      { status: 502 }
    );
  }
}
