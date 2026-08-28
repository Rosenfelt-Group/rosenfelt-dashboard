import { NextResponse } from "next/server";

export const maxDuration = 20;

export interface MercuryTransaction {
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense";
  category: string;
}

export async function GET() {
  const baseUrl = process.env.SAM_AGENT_URL;
  const secret = process.env.SAM_WEBHOOK_SECRET ?? process.env.JORDAN_WEBHOOK_SECRET ?? "";

  if (!baseUrl) {
    return NextResponse.json({ transactions: [], error: "SAM_AGENT_URL not configured" });
  }

  try {
    const res = await fetch(`${baseUrl}/mercury/transactions`, {
      headers: { "X-Webhook-Secret": secret },
      signal: AbortSignal.timeout(18000),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { transactions: [], error: `sam-agent HTTP ${res.status}` },
        { status: 200 },
      );
    }

    return NextResponse.json(await res.json());
  } catch (e: unknown) {
    return NextResponse.json(
      { transactions: [], error: e instanceof Error ? e.message : "sam-agent unreachable" },
      { status: 200 },
    );
  }
}
