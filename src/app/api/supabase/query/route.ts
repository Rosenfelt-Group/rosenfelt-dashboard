import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const cookieToken = req.cookies.get(COOKIE_NAME)?.value;
  if (!cookieToken) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }
  const session = await verifySessionToken(cookieToken);
  if (!session) {
    return NextResponse.json({ detail: "Invalid session" }, { status: 401 });
  }

  const { sql } = await req.json().catch(() => ({}));
  if (!sql || typeof sql !== "string" || !sql.trim()) {
    return NextResponse.json({ detail: "Missing sql" }, { status: 400 });
  }

  const start = Date.now();
  let rowCount = 0;
  let durationMs = 0;
  let errorMsg: string | null = null;

  try {
    const { data, error } = await supabaseAdmin.rpc("run_sql", { query: sql });

    durationMs = Date.now() - start;

    if (error) {
      errorMsg = error.message;
      await logQuery(sql, 0, durationMs, errorMsg);
      return NextResponse.json({ detail: errorMsg }, { status: 400 });
    }

    const rows: Record<string, unknown>[] = Array.isArray(data) ? data : [];
    rowCount = rows.length;
    const columns = rowCount > 0 ? Object.keys(rows[0]) : [];
    const rowValues = rows.map((r) => columns.map((c) => r[c] ?? null));

    await logQuery(sql, rowCount, durationMs, null);

    return NextResponse.json({
      columns,
      rows: rowValues,
      row_count: rowCount,
      duration_ms: durationMs,
    });
  } catch (err: unknown) {
    durationMs = Date.now() - start;
    errorMsg = err instanceof Error ? err.message : String(err);
    await logQuery(sql, 0, durationMs, errorMsg);
    return NextResponse.json({ detail: errorMsg }, { status: 500 });
  }
}

async function logQuery(
  sql: string,
  rowCount: number,
  durationMs: number,
  error: string | null
) {
  try {
    await supabaseAdmin.from("sql_query_log").insert({
      sql,
      row_count: rowCount,
      duration_ms: durationMs,
      error,
      executed_at: new Date().toISOString(),
    });
  } catch {
    // never let logging failure bubble up
  }
}
