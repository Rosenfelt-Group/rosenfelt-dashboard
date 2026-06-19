import { NextResponse } from "next/server";

export const maxDuration = 15;

// Proxies the Kick bookkeeping connectivity snapshot from sam-agent.
export async function GET() {
  const baseUrl = process.env.SAM_AGENT_URL;
  const secret = process.env.SAM_WEBHOOK_SECRET ?? process.env.JORDAN_WEBHOOK_SECRET ?? "";
  if (!baseUrl) {
    return NextResponse.json(
      { configured: false, connected: false, error: "SAM_AGENT_URL not configured" },
      { status: 200 },
    );
  }
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}/kick/status`, {
      headers: { "X-Webhook-Secret": secret },
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { configured: true, connected: false, error: `sam-agent HTTP ${res.status}` },
        { status: 200 },
      );
    }
    return NextResponse.json(await res.json());
  } catch (e: unknown) {
    return NextResponse.json(
      {
        configured: true,
        connected: false,
        proxy_latency_ms: Date.now() - start,
        error: e instanceof Error ? e.message : "sam-agent unreachable",
      },
      { status: 200 },
    );
  }
}
