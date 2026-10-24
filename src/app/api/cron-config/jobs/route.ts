import { NextRequest, NextResponse } from "next/server";
import { AGENT_URLS, AGENT_SECRETS } from "@/lib/agent-urls";
import { checksConfig } from "@/lib/checks";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

type Job = { job_id: string; next_run_time: string | null; trigger?: string };

// Each scheduler's GET /scheduler/jobs, tagged with its owner. Casey and the checks service share job ids
// (the checks jobs were Casey's), so the panel keys next-run times by agent + job_id.
async function jobsFrom(agent: string, url: string | undefined, secret: string | undefined) {
  if (!url || !secret) return [];
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/scheduler/jobs`, {
      headers: { "X-Webhook-Secret": secret },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { jobs?: Job[] };
    return (body.jobs ?? []).map(j => ({ ...j, agent }));
  } catch {
    return [];
  }
}

// Secret-protected both at the dashboard (session required) and at each scheduler (X-Webhook-Secret).
export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const session = await verifySessionToken(token);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const checks = checksConfig();
  const [casey, checksJobs] = await Promise.all([
    jobsFrom("casey", AGENT_URLS.casey, AGENT_SECRETS.casey),
    jobsFrom("checks", checks?.url, checks?.secret),
  ]);
  return NextResponse.json({ jobs: [...checksJobs, ...casey] });
}
