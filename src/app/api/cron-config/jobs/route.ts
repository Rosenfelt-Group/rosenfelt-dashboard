import { NextRequest, NextResponse } from "next/server";
import { AGENT_URLS, AGENT_SECRETS } from "@/lib/agent-urls";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

// Proxy GET /scheduler/jobs from Casey — returns job list with next_run_time.
// Secret-protected both at the dashboard (session required) and at Casey (X-Webhook-Secret).
export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const session = await verifySessionToken(token);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const caseyUrl = AGENT_URLS.casey;
  const caseySecret = AGENT_SECRETS.casey;
  if (!caseyUrl || !caseySecret) {
    return NextResponse.json({ jobs: [], error: "Casey not configured" });
  }

  try {
    const res = await fetch(`${caseyUrl.replace(/\/$/, "")}/scheduler/jobs`, {
      headers: { "X-Webhook-Secret": caseySecret },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NextResponse.json({ jobs: [] });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ jobs: [] });
  }
}
