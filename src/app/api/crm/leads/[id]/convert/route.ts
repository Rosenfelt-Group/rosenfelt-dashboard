import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { service_tier, contract_start } = await req.json().catch(() => ({}));

  const { data: lead, error: leadError } = await supabaseAdmin
    .schema("crm")
    .from("leads")
    .select("*")
    .eq("id", id)
    .single();
  if (leadError || !lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (lead.stage !== "won") return NextResponse.json({ error: "Lead must be in won stage" }, { status: 400 });

  const { data: client, error: clientError } = await supabaseAdmin
    .schema("crm")
    .from("clients")
    .insert({
      lead_id: lead.id,
      business_id: lead.business_id,
      contact_id: lead.contact_id,
      // service_tier and monthly_value were dropped from crm.clients (2026-05-26); services and rates live
      // in crm.client_services, added on the organization's Billing tab.
      contract_start: contract_start || null,
      billing_status: "active",
    })
    .select()
    .single();
  if (clientError) return NextResponse.json({ error: clientError.message }, { status: 500 });

  await supabaseAdmin
    .schema("crm")
    .from("leads")
    .update({ converted_at: new Date().toISOString() })
    .eq("id", id);

  await supabaseAdmin
    .schema("crm")
    .from("lead_activities")
    .insert({
      lead_id: id,
      activity_type: "system",
      content: `Converted to client — ${service_tier ?? "no tier set"}`,
      logged_by: "brian",
    });

  return NextResponse.json(client, { status: 201 });
}
