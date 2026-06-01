import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/work/sprint-numbers
// Returns distinct INTEGER phase buckets from work_items, ordered ascending.
// Phases group by the floor of sprint_number, so 1.0 / 1.2 / 1.6 all collapse
// to bucket 1. Used by the work module Phase filter dropdown.
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("work_items")
      .select("sprint_number")
      .not("sprint_number", "is", null)
      .order("sprint_number", { ascending: true });

    if (error) throw error;

    const seen = new Set<number>();
    for (const row of (data ?? []) as { sprint_number: number | null }[]) {
      const n = row.sprint_number;
      if (typeof n === "number") seen.add(Math.floor(n));
    }
    const distinct = Array.from(seen).sort((a, b) => a - b);
    return NextResponse.json(distinct);
  } catch (err) {
    console.error("sprint-numbers GET error:", err);
    return NextResponse.json([], { status: 500 });
  }
}
