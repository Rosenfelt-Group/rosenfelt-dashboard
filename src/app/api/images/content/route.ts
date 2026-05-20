import { NextRequest, NextResponse } from "next/server";

const JORDAN_API_URL = process.env.JORDAN_API_URL ?? "";
const JORDAN_WEBHOOK_SECRET = process.env.JORDAN_WEBHOOK_SECRET ?? "";

export async function GET(req: NextRequest) {
  if (!JORDAN_API_URL) {
    return new NextResponse("JORDAN_API_URL not configured", { status: 503 });
  }
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return new NextResponse("path required", { status: 400 });
  try {
    const url = new URL(`${JORDAN_API_URL}/image`);
    url.searchParams.set("path", path);
    const res = await fetch(url.toString(), {
      headers: { "X-Webhook-Secret": JORDAN_WEBHOOK_SECRET },
      cache: "no-store",
    });
    if (!res.ok) return new NextResponse("not found", { status: res.status });
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const data = await res.arrayBuffer();
    return new NextResponse(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("Failed to reach Jordan", { status: 502 });
  }
}
