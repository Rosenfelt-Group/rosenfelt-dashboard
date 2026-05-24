import { NextResponse } from "next/server";

export const maxDuration = 15;

const AGENTS = [
  { name: "jordan", urlVar: "JORDAN_API_URL",  secretVar: "JORDAN_WEBHOOK_SECRET" },
  { name: "riley",  urlVar: "RILEY_AGENT_URL",  secretVar: "RILEY_WEBHOOK_SECRET"  },
  { name: "avery",  urlVar: "AVERY_AGENT_URL",  secretVar: "AVERY_WEBHOOK_SECRET"  },
  { name: "casey",  urlVar: "CASEY_AGENT_URL",  secretVar: "CASEY_WEBHOOK_SECRET"  },
] as const;

export async function GET() {
  const results = await Promise.all(
    AGENTS.map(async ({ name, urlVar, secretVar }) => {
      const baseUrl = process.env[urlVar];
      const secret  = process.env[secretVar] ?? process.env.JORDAN_WEBHOOK_SECRET ?? "";
      if (!baseUrl) {
        return { agent: name, status: "unknown", latency_ms: null, detail: null, error: "URL not configured" };
      }
      const start = Date.now();
      try {
        const res = await fetch(`${baseUrl}/health`, {
          headers: { "X-Webhook-Secret": secret },
          signal: AbortSignal.timeout(6000),
          cache: "no-store",
        });
        const latency_ms = Date.now() - start;
        const detail = res.ok ? await res.json().catch(() => null) : null;
        return {
          agent: name,
          status: res.ok ? "up" : "down",
          latency_ms,
          detail,
          error: res.ok ? null : `HTTP ${res.status}`,
        };
      } catch (e: unknown) {
        return {
          agent: name,
          status: "down",
          latency_ms: Date.now() - start,
          detail: null,
          error: e instanceof Error ? e.message : "Unreachable",
        };
      }
    })
  );
  return NextResponse.json(results);
}
