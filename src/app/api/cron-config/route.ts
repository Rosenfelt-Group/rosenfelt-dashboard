import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { AGENT_URLS, AGENT_SECRETS } from "@/lib/agent-urls";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

// Validate a 5-field crontab expression. Returns error string or null.
function validateCron(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return "Must be a 5-field cron expression: MIN HOUR DOM MON DOW";
  }
  // Each field: *, */n, n, n-m, n,m, or 3-letter day/month name
  const valid = /^(\*|\*\/\d+|\d+(-\d+)?(,\d+(-\d+)?)*)$|^(sun|mon|tue|wed|thu|fri|sat|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/i;
  const names = ["minute", "hour", "day-of-month", "month", "day-of-week"];
  for (let i = 0; i < 5; i++) {
    if (!valid.test(parts[i].trim())) {
      return `Invalid ${names[i]} field: "${parts[i]}"`;
    }
  }
  return null;
}

// Estimate minimum interval in seconds for simple cron patterns.
// Used to enforce the per-row min_interval_seconds floor server-side.
function estimateMinIntervalSeconds(cron: string): number {
  const [min, hour] = cron.trim().split(/\s+/);
  const stepMatch = min.match(/^\*\/(\d+)$/);
  if (stepMatch) return parseInt(stepMatch[1]) * 60;
  if (min === "*" && hour === "*") return 60;   // fires every minute
  if (min === "*") return 3600;                 // fixed hour, * minute → hourly
  return 86400;                                 // fixed min+hour → at least daily
}

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("agent_cron_config")
      .select("agent, job_id, cron, enabled, min_interval_seconds, updated_by, updated_at")
      .order("agent")
      .order("job_id");
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("cron-config GET:", err);
    return NextResponse.json({ error: "Failed to load cron config" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const session = await verifySessionToken(token);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { agent?: string; job_id?: string; cron?: string; enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { agent, job_id, cron, enabled } = body;
  if (!agent || typeof agent !== "string") {
    return NextResponse.json({ error: "Missing or invalid agent" }, { status: 400 });
  }
  if (!job_id || typeof job_id !== "string") {
    return NextResponse.json({ error: "Missing or invalid job_id" }, { status: 400 });
  }

  // Server-side cron validation and floor enforcement
  if (cron !== undefined) {
    const cronErr = validateCron(cron);
    if (cronErr) return NextResponse.json({ error: cronErr }, { status: 400 });

    const { data: row } = await supabaseAdmin
      .from("agent_cron_config")
      .select("min_interval_seconds")
      .eq("agent", agent)
      .eq("job_id", job_id)
      .single();
    const floor = row?.min_interval_seconds ?? 300;
    const estimated = estimateMinIntervalSeconds(cron);
    if (estimated < floor) {
      return NextResponse.json(
        { error: `Cron would fire every ~${estimated}s — below this job's ${floor}s minimum interval floor` },
        { status: 400 },
      );
    }
  }

  const updates: Record<string, unknown> = {
    updated_by: session.username,
    updated_at: new Date().toISOString(),
  };
  if (cron !== undefined) updates.cron = cron;
  if (enabled !== undefined) updates.enabled = enabled;

  const { error: updateErr } = await supabaseAdmin
    .from("agent_cron_config")
    .update(updates)
    .eq("agent", agent)
    .eq("job_id", job_id);
  if (updateErr) {
    console.error("cron-config PATCH DB error:", updateErr);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Ping agent's reschedule endpoint so changes apply live (no restart needed)
  const agentKey = agent as keyof typeof AGENT_URLS;
  const agentUrl = AGENT_URLS[agentKey];
  const agentSecret = AGENT_SECRETS[agentKey];

  if (agentUrl && agentSecret) {
    try {
      const res = await fetch(`${agentUrl.replace(/\/$/, "")}/scheduler/reschedule`, {
        method: "POST",
        headers: { "X-Webhook-Secret": agentSecret },
      });
      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json({
          status: "db_updated_reschedule_failed",
          detail: `DB updated but ${agent} reschedule returned ${res.status}: ${text.slice(0, 200)}`,
        });
      }
      const rescheduleResult = await res.json();
      return NextResponse.json({ status: "ok", reschedule: rescheduleResult });
    } catch (err) {
      return NextResponse.json({
        status: "db_updated_reschedule_failed",
        detail: `DB updated but could not reach ${agent}: ${err}`,
      });
    }
  }

  return NextResponse.json({ status: "ok" });
}
