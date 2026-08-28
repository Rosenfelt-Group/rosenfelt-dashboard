import { NextResponse } from "next/server";

export const maxDuration = 15;

export interface MercuryAccount {
  id: string;
  name: string;
  type: string;
  balance: number;
}

export async function GET() {
  const baseUrl = process.env.SAM_AGENT_URL;
  const secret = process.env.SAM_WEBHOOK_SECRET ?? process.env.JORDAN_WEBHOOK_SECRET ?? "";

  if (!baseUrl) {
    return NextResponse.json({ accounts: [], error: "SAM_AGENT_URL not configured" });
  }

  try {
    const res = await fetch(`${baseUrl}/mercury/accounts`, {
      headers: { "X-Webhook-Secret": secret },
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { accounts: [], error: `sam-agent HTTP ${res.status}` },
        { status: 200 },
      );
    }

    return NextResponse.json(await res.json());
  } catch (e: unknown) {
    return NextResponse.json(
      { accounts: [], error: e instanceof Error ? e.message : "sam-agent unreachable" },
      { status: 200 },
    );
  }
}
