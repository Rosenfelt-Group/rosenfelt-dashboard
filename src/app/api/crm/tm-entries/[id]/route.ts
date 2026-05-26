import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// PATCH /api/crm/tm-entries/[id]  (unbilled rows only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { data: row, error: fetchErr } = await supabaseAdmin
    .schema("crm")
    .from("tm_billing_entries")
    .select("id, billed")
    .eq("id", id)
    .single();
  if (fetchErr) {
    if (fetchErr.code === "PGRST116") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (row.billed) {
    return NextResponse.json({ error: "Cannot edit a billed entry" }, { status: 409 });
  }

  const allowed = ["entry_date", "hours", "description", "logged_by", "work_item_id"];
  const update: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) update[k] = body[k];
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No editable fields in body" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("tm_billing_entries")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    console.error("tm-entries PATCH:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

// DELETE /api/crm/tm-entries/[id]  (unbilled rows only)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data: row, error: fetchErr } = await supabaseAdmin
    .schema("crm")
    .from("tm_billing_entries")
    .select("id, billed")
    .eq("id", id)
    .single();
  if (fetchErr) {
    if (fetchErr.code === "PGRST116") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (row.billed) {
    return NextResponse.json({ error: "Cannot delete a billed entry" }, { status: 409 });
  }

  const { error } = await supabaseAdmin
    .schema("crm")
    .from("tm_billing_entries")
    .delete()
    .eq("id", id);
  if (error) {
    console.error("tm-entries DELETE:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ deleted: true });
}
