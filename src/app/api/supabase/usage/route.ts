import { NextResponse } from "next/server";

const PROJECT_REF = "ukfpmpxwdlpsjqbxreza";
const ORG_ID      = "znhxpkxsrelwlxufbbtr";
const MGMT_BASE   = "https://api.supabase.com/v1";

export const maxDuration = 15;

async function managementSql(token: string, query: string) {
  const res = await fetch(`${MGMT_BASE}/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return Array.isArray(body) ? body : (body?.result ?? null);
}

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
    const [orgRes, dbStats] = await Promise.all([
      fetch(`${MGMT_BASE}/organizations/${ORG_ID}`, { headers, signal: AbortSignal.timeout(8_000) }),
      managementSql(token, `
        SELECT
          ROUND(blks_hit::numeric / NULLIF(blks_hit + blks_read, 0) * 100, 1) AS cache_hit_pct,
          xact_commit,
          xact_rollback,
          deadlocks,
          tup_returned,
          tup_inserted,
          tup_updated,
          tup_deleted
        FROM pg_stat_database
        WHERE datname = current_database()
      `),
    ]);

    const org  = orgRes.ok ? await orgRes.json() : null;
    const plan = org?.plan ?? null;

    const row = dbStats?.[0] ?? null;

    return NextResponse.json({
      configured:    true,
      plan:          plan ?? "unknown",
      // Egress not available via Management API — link to Supabase dashboard
      egress_gb:     null,
      // DB health from pg_stat_database
      cache_hit_pct:  row?.cache_hit_pct  !== undefined ? parseFloat(row.cache_hit_pct) : null,
      xact_commit:    row?.xact_commit    ?? null,
      xact_rollback:  row?.xact_rollback  ?? null,
      deadlocks:      row?.deadlocks      ?? null,
      tup_returned:   row?.tup_returned   ?? null,
      tup_inserted:   row?.tup_inserted   ?? null,
      tup_updated:    row?.tup_updated    ?? null,
      tup_deleted:    row?.tup_deleted    ?? null,
    });
  } catch (err) {
    console.error("supabase/usage error:", err);
    return NextResponse.json({ configured: true, error: "Failed to fetch stats" });
  }
}
