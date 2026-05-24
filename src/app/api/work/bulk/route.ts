import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Bulk PATCH up to 100 work_items in one call. Used by the BulkActionBar
// to apply status/priority/assigned_agent/archive to multiple selected items.

const EDITABLE_FIELDS = new Set([
  "title", "description", "summary", "work_type", "priority", "status",
  "assigned_agent", "suggested_by", "prompt", "arch_notes",
  "due_date", "archived",
]);

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const ids: unknown = body.ids;
  const updates: unknown = body.updates;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids array required" }, { status: 400 });
  }
  if (ids.length > 100) {
    return NextResponse.json({ error: "max 100 ids per request" }, { status: 400 });
  }
  if (!updates || typeof updates !== "object") {
    return NextResponse.json({ error: "updates object required" }, { status: 400 });
  }

  // Filter to editable fields only
  const cleanUpdates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates as Record<string, unknown>)) {
    if (EDITABLE_FIELDS.has(k)) cleanUpdates[k] = v;
  }
  if (Object.keys(cleanUpdates).length === 0) {
    return NextResponse.json({ error: "no editable fields in updates" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("work_items")
    .update(cleanUpdates)
    .in("id", ids as string[])
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    updated: data?.length ?? 0,
    ids: data?.map((r) => r.id) ?? [],
  });
}
