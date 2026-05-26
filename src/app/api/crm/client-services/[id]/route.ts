import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/crm/client-services/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("client_services")
    .select("*, service_template:service_templates(*), client:clients(*, business:businesses(*), contact:contacts(*))")
    .eq("id", id)
    .single();
  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("client-services GET:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

// PATCH /api/crm/client-services/[id]
// Whitelist of editable fields — Stripe-managed fields are intentionally excluded
// so they can only be changed by the activate/webhook flows.
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

  const allowed = [
    "monthly_rate", "project_rate", "hourly_rate",
    "billing_start_date", "billing_end_date",
    "status", "notes",
  ];
  const update: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) update[k] = body[k];
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No editable fields in body" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("client_services")
    .update(update)
    .eq("id", id)
    .select("*, service_template:service_templates(*)")
    .single();
  if (error) {
    console.error("client-services PATCH:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

// DELETE /api/crm/client-services/[id]
// Only allowed for rows that haven't been billing-activated yet — anything
// with a Stripe subscription stays in the DB for the audit trail (cancel via
// status='cancelled' instead).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data: row, error: fetchErr } = await supabaseAdmin
    .schema("crm")
    .from("client_services")
    .select("id, stripe_subscription_id, status")
    .eq("id", id)
    .single();
  if (fetchErr) {
    if (fetchErr.code === "PGRST116") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (row.stripe_subscription_id) {
    return NextResponse.json(
      { error: "Refusing to delete: row has a Stripe subscription. Set status='cancelled' instead." },
      { status: 409 },
    );
  }

  const { error } = await supabaseAdmin
    .schema("crm")
    .from("client_services")
    .delete()
    .eq("id", id);
  if (error) {
    console.error("client-services DELETE:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ deleted: true });
}
