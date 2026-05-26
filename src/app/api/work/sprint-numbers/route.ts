import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/work/sprint-numbers
// Returns distinct sprint_number integers from work_items, ordered ascending.
// Used by the work module Sprint filter dropdown.
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("work_items")
      .select("sprint_number")
      .not("sprint_number", "is", null)
      .order("sprint_number", { ascending: true });

    if (error) throw error;

    const seen = new Set<number>();
    const distinct: number[] = [];
    for (const row of (data ?? []) as { sprint_number: number | null }[]) {
      const n = row.sprint_number;
      if (typeof n === "number" && !seen.has(n)) {
        seen.add(n);
        distinct.push(n);
      }
    }
    return NextResponse.json(distinct);
  } catch (err) {
    console.error("sprint-numbers GET error:", err);
    return NextResponse.json([], { status: 500 });
  }
}
