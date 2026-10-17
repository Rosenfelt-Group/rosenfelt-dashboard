import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Casey's doc/code alignment findings, matched by title. The patterns are
// fixed here so no caller-supplied text reaches the PostgREST or() filter.
const ALIGNMENT_PATTERNS = [
  "%tool count drift%",
  "%phantom table in docs%",
  "%undocumented table: public%",
  "%phantom endpoint in docs%",
];

export async function GET() {
  const orFilter = ALIGNMENT_PATTERNS.map((p) => `title.ilike.${p}`).join(",");
  const { data, error } = await supabaseAdmin
    .from("work_items")
    .select("id, ref, title, description, priority, status, created_at")
    .or(orFilter)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("alignment-findings error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}
