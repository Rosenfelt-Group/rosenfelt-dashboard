import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/crm/tm-entries?client_service_id=<uuid>
// Lists entries for a specific service, newest first.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const csId = searchParams.get("client_service_id");
  if (!csId) {
    return NextResponse.json({ error: "client_service_id query param required" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("tm_billing_entries")
    .select("*")
    .eq("client_service_id", csId)
    .order("entry_date", { ascending: false })
    .limit(500);
  if (error) {
    console.error("tm-entries GET:", error);
    return NextResponse.json([], { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

// POST /api/crm/tm-entries
// Logs T&M hours against a client service. Body:
//   client_service_id, entry_date (YYYY-MM-DD), hours, description,
//   logged_by? (default 'brian'), work_item_id?
//
// Validates the parent client_service has billing_type='tm'.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.client_service_id || !body.entry_date || !body.description || body.hours === undefined) {
    return NextResponse.json(
      { error: "client_service_id, entry_date, hours, description are required" },
      { status: 400 },
    );
  }
  const hours = Number(body.hours);
  if (!Number.isFinite(hours) || hours <= 0) {
    return NextResponse.json({ error: "hours must be a positive number" }, { status: 400 });
  }

  // Guard: parent service must be billing_type='tm'
  const { data: service, error: svcErr } = await supabaseAdmin
    .schema("crm")
    .from("client_services")
    .select("id, service_template:service_templates(billing_type)")
    .eq("id", body.client_service_id)
    .single();
  if (svcErr) {
    if (svcErr.code === "PGRST116") {
      return NextResponse.json({ error: "client_service not found" }, { status: 404 });
    }
    return NextResponse.json({ error: svcErr.message }, { status: 500 });
  }
  const tmpl = Array.isArray(service.service_template) ? service.service_template[0] : service.service_template;
  if (tmpl?.billing_type !== "tm") {
    return NextResponse.json(
      { error: `Parent service billing_type is '${tmpl?.billing_type}', not 'tm'` },
      { status: 422 },
    );
  }

  const insert = {
    client_service_id: body.client_service_id,
    entry_date: body.entry_date,
    hours,
    description: body.description,
    logged_by: body.logged_by ?? "brian",
    work_item_id: body.work_item_id ?? null,
    billed: false,
  };

  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("tm_billing_entries")
    .insert(insert)
    .select()
    .single();
  if (error) {
    console.error("tm-entries POST:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
