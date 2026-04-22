import { NextRequest, NextResponse } from "next/server";

const JORDAN_API_URL = process.env.JORDAN_API_URL ?? "";
const JORDAN_WEBHOOK_SECRET = process.env.JORDAN_WEBHOOK_SECRET ?? "";

export async function GET(req: NextRequest) {
  if (!JORDAN_API_URL) {
    return NextResponse.json({ error: "JORDAN_API_URL not configured" }, { status: 503 });
  }
  const path = req.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "path query parameter required" }, { status: 400 });
  }
  try {
    const url = new URL(`${JORDAN_API_URL}/doc`);
    url.searchParams.set("path", path);
    const res = await fetch(url.toString(), {
      headers: { "X-Webhook-Secret": JORDAN_WEBHOOK_SECRET },
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Failed to reach Jordan" }, { status: 502 });
  }
}
