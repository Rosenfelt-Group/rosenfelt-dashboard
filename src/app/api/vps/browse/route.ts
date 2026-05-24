import { NextRequest, NextResponse } from "next/server";

// /api/vps/browse — proxy to Jordan's POST /files/list endpoint.
//
// Jordan's endpoint enforces the same /opt/rosenfelt/ whitelist; this route
// also rejects bad paths up front so we don't waste a network hop.

const ALLOWED_PREFIX = "/opt/rosenfelt/";

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") || "/opt/rosenfelt/docs";

  if (!path.startsWith(ALLOWED_PREFIX)) {
    return NextResponse.json(
      { error: `path must start with ${ALLOWED_PREFIX}` },
      { status: 400 },
    );
  }
  if (path.includes("..")) {
    return NextResponse.json({ error: "path traversal not allowed" }, { status: 400 });
  }

  const jordanUrl = process.env.JORDAN_API_URL;
  const jordanSecret = process.env.JORDAN_WEBHOOK_SECRET;
  if (!jordanUrl || !jordanSecret) {
    return NextResponse.json({ error: "Jordan agent not configured" }, { status: 500 });
  }

  try {
    const res = await fetch(`${jordanUrl.replace(/\/$/, "")}/files/list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": jordanSecret,
      },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Jordan /files/list failed: ${text}` },
        { status: 502 },
      );
    }
    const data = await res.json();
    return NextResponse.json({ path: data.path ?? path, files: data.files ?? [] });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
