import { NextResponse } from "next/server";

const PROJECT_REF = "ukfpmpxwdlpsjqbxreza";
const MGMT_BASE   = "https://api.supabase.com/v1";

export const maxDuration = 15;

async function managementSql(token: string, query: string) {
  const res = await fetch(`${MGMT_BASE}/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const body = await res.json();
  // Management API returns array of rows directly, or { result: [...] }
  return Array.isArray(body) ? body : (body?.result ?? null);
}

export async function GET() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }

  try {
    const [tables, dbSize] = await Promise.all([
      managementSql(token, `
        SELECT
          relname                                                              AS table_name,
          n_live_tup                                                           AS row_count,
          pg_total_relation_size(schemaname || '.' || relname)                AS size_bytes,
          pg_size_pretty(pg_total_relation_size(schemaname || '.' || relname)) AS size_pretty
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        ORDER BY size_bytes DESC
        LIMIT 12
      `),
      managementSql(token, `
        SELECT
          pg_database_size(current_database())                 AS size_bytes,
          pg_size_pretty(pg_database_size(current_database())) AS size_pretty
      `),
    ]);

    return NextResponse.json({
      configured: true,
      tables: tables ?? [],
      db_size: dbSize?.[0] ?? null,
    });
  } catch (err) {
    console.error("supabase/metrics error:", err);
    return NextResponse.json({ configured: true, error: "Query failed", tables: [], db_size: null });
  }
}
