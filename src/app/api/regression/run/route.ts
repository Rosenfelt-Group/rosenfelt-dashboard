import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";
import { AGENT_URLS, AGENT_SECRETS } from "@/lib/agent-urls";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const session = await verifySessionToken(token);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const baseUrl = AGENT_URLS.casey;
  const secret = AGENT_SECRETS.casey;
  if (!baseUrl || !secret) {
    return NextResponse.json(
      { error: "Casey agent URL or secret is not configured" },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/regression/run`, {
      method: "POST",
      headers: {
        "X-Webhook-Secret": secret,
        "X-Triggered-By-User": session.username,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json(
        { error: `Casey returned ${res.status}: ${body}` },
        { status: 502 },
      );
    }

    return NextResponse.json({ status: "accepted" });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
