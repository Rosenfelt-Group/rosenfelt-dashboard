import { NextResponse } from "next/server";

const PROJECT_REF = "ukfpmpxwdlpsjqbxreza";
const ORG_ID      = "znhxpkxsrelwlxufbbtr";
const MGMT_BASE   = "https://api.supabase.com/v1";

export const maxDuration = 15;

export async function GET() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ configured: false });
  }

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  try {
    // Fetch project details, org usage, and recent API logs in parallel
    const [projectRes, usageRes, logsRes] = await Promise.all([
      fetch(`${MGMT_BASE}/projects/${PROJECT_REF}`, { headers, signal: AbortSignal.timeout(8_000) }),
      fetch(`${MGMT_BASE}/organizations/${ORG_ID}/usage`, { headers, signal: AbortSignal.timeout(8_000) }),
      // Last 100 API log entries to compute error rate
      fetch(`${MGMT_BASE}/projects/${PROJECT_REF}/logs?service=api&limit=100`, { headers, signal: AbortSignal.timeout(8_000) }),
    ]);

    const project = projectRes.ok ? await projectRes.json() : null;
    const usage   = usageRes.ok   ? await usageRes.json()   : null;
    const logs    = logsRes.ok    ? await logsRes.json()    : null;

    // Parse egress from usage response (handle multiple possible shapes)
    let egress_gb: number | null    = null;
    let egress_limit_gb: number | null = null;
    let plan: string | null = project?.subscription_tier ?? project?.plan?.id ?? null;

    if (usage) {
      // Shape 1: { metrics: [{ metric: "egress", usage: N, limit: N }] }
      const egressMetric = usage?.metrics?.find((m: { metric: string }) => m.metric === "egress");
      if (egressMetric) {
        egress_gb       = typeof egressMetric.usage === "number" ? egressMetric.usage / 1e9 : null;
        egress_limit_gb = typeof egressMetric.limit === "number" ? egressMetric.limit / 1e9 : null;
      }
      // Shape 2: { egress: { used: N, limit: N } }
      if (egress_gb === null && usage?.egress) {
        egress_gb       = typeof usage.egress.used  === "number" ? usage.egress.used  / 1e9 : null;
        egress_limit_gb = typeof usage.egress.limit === "number" ? usage.egress.limit / 1e9 : null;
      }
      // Shape 3: { egress_bytes: N }
      if (egress_gb === null && typeof usage?.egress_bytes === "number") {
        egress_gb = usage.egress_bytes / 1e9;
      }
    }

    // Plan → default egress limit if API doesn't return it
    if (egress_limit_gb === null) {
      if (plan === "pro" || plan === "Pro") egress_limit_gb = 250;
      else if (plan === "free" || plan === "Free") egress_limit_gb = 5;
    }

    // Parse error rate from logs
    let requests_1h = 0;
    let errors_1h   = 0;
    const logEntries: Array<{ status_code?: number; timestamp?: number }> =
      Array.isArray(logs) ? logs : (logs?.result ?? []);

    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const entry of logEntries) {
      const ts = entry.timestamp ? entry.timestamp / 1000 : 0; // µs → ms
      if (ts < oneHourAgo) continue;
      requests_1h++;
      if (entry.status_code && entry.status_code >= 400) errors_1h++;
    }

    return NextResponse.json({
      configured:     true,
      plan:           plan ?? "unknown",
      egress_gb,
      egress_limit_gb,
      egress_pct:     egress_gb !== null && egress_limit_gb ? (egress_gb / egress_limit_gb) * 100 : null,
      requests_1h:    requests_1h || null,
      errors_1h:      errors_1h,
      error_rate:     requests_1h > 0 ? (errors_1h / requests_1h) * 100 : null,
      // Raw responses for debugging if needed
      _raw_usage:     usage,
    });
  } catch (err) {
    console.error("supabase/usage error:", err);
    return NextResponse.json({ configured: true, error: "Failed to fetch usage" });
  }
}
