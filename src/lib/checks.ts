// src/lib/checks.ts
//
// The checks service (rosably-agents services/checks): Rosably's scheduled fixed-code checks — regression,
// patch detection, alignment, GSC, indexer health, memory maintenance. It is not an agent and never a
// dispatch target. Its own secret (CHECKS_WEBHOOK_SECRET) with no fallback to any agent's secret.
// Env is read at call time.
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

export type ChecksConfig = { url: string; secret: string };

export function checksConfig(env: Record<string, string | undefined> = process.env): ChecksConfig | null {
  const url = env.CHECKS_URL?.trim().replace(/\/+$/, "");
  const secret = env.CHECKS_WEBHOOK_SECRET;
  return url && secret ? { url, secret } : null;
}

/** Admin-only proxy for a manual "run now" on the checks service (regression, patch scan, alignment). */
export async function runOnChecks(req: NextRequest, path: string): Promise<NextResponse> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const session = await verifySessionToken(token);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const checks = checksConfig();
  if (!checks) {
    return NextResponse.json({ error: "Checks service URL or secret is not configured" }, { status: 500 });
  }

  try {
    const res = await fetch(`${checks.url}${path}`, {
      method: "POST",
      headers: { "X-Webhook-Secret": checks.secret, "X-Triggered-By-User": session.username },
    });
    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({ error: `Checks returned ${res.status}: ${body.slice(0, 300)}` }, { status: 502 });
    }
    return NextResponse.json({ status: "accepted" });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
