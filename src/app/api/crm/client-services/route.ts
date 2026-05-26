import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// POST /api/crm/client-services
// Adds a service to a client. Row starts in status='pending_activation';
// /activate moves it to 'active' once billing is set up.
// Body: { client_id, service_template_id, monthly_rate?, project_rate?,
//         hourly_rate?, billing_start_date?, notes? }
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.client_id || !body.service_template_id) {
    return NextResponse.json({ error: "client_id and service_template_id are required" }, { status: 400 });
  }

  const insert = {
    client_id: body.client_id,
    service_template_id: body.service_template_id,
    monthly_rate: body.monthly_rate ?? null,
    project_rate: body.project_rate ?? null,
    hourly_rate: body.hourly_rate ?? null,
    billing_start_date: body.billing_start_date ?? null,
    notes: body.notes ?? null,
    status: "pending_activation",
  };

  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("client_services")
    .insert(insert)
    .select("*, service_template:service_templates(*)")
    .single();

  if (error) {
    console.error("client-services POST:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
