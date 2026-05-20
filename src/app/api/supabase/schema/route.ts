import { NextResponse } from "next/server";

const PROJECT_REF = "ukfpmpxwdlpsjqbxreza";
const MGMT_BASE   = "https://api.supabase.com/v1";

export const maxDuration = 15;

interface SchemaColumn { name: string; type: string }
interface SchemaTable  { name: string; columns: SchemaColumn[] }

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
  return Array.isArray(body) ? body : (body?.result ?? null);
}

export async function GET() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ tables: [] });
  }

  try {
    const rows = await managementSql(token, `
      SELECT c.table_name, c.column_name, c.data_type
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON c.table_name = t.table_name AND c.table_schema = t.table_schema
      WHERE c.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.ordinal_position
    `);

    if (!rows) return NextResponse.json({ tables: [] });

    const tableMap = new Map<string, SchemaColumn[]>();
    for (const row of rows as { table_name: string; column_name: string; data_type: string }[]) {
      if (!tableMap.has(row.table_name)) tableMap.set(row.table_name, []);
      tableMap.get(row.table_name)!.push({ name: row.column_name, type: row.data_type });
    }

    const tables: SchemaTable[] = Array.from(tableMap.entries())
      .map(([name, columns]) => ({ name, columns }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ tables });
  } catch (err) {
    console.error("supabase/schema error:", err);
    return NextResponse.json({ tables: [] });
  }
}
