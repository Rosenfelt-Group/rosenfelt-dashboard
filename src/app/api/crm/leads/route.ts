import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { intakeLead } from "@/lib/intake/client";
import { IntakeSchema } from "@/lib/intake/schema";

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("leads")
    .select("*, business:businesses(*), contact:contacts(*)")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json([], { status: 500 });
  return NextResponse.json(data ?? []);
}

const LEAD_SELECT = "*, business:businesses(*), contact:contacts(*)";

// Create a lead. When an email is known (sent directly, or on the contact), it goes through
// crm.intake_lead so contacts and open leads deduplicate by email. Without an email, intake
// cannot be used, so the row is inserted directly as before.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const body = await req.json();
  const crm = supabaseAdmin.schema("crm");

  let email: string | undefined = typeof body.email === "string" ? body.email.trim() : undefined;
  let name: string | undefined = typeof body.first_name === "string"
    ? [body.first_name, body.last_name].filter(Boolean).join(" ") : undefined;
  if (!email && body.contact_id) {
    const { data: c } = await crm.from("contacts").select("first_name, last_name, email").eq("id", body.contact_id).single();
    email = c?.email?.trim() || undefined;
    name = name ?? ([c?.first_name, c?.last_name].filter(Boolean).join(" ") || undefined);
  }

  if (email) {
    const parsed = IntakeSchema.safeParse({
      channel: body.source ?? "manual",
      email,
      name,
      org: typeof body.org === "string" ? body.org : undefined,
      stage: body.stage ?? undefined,
      estimated_value: body.estimated_value ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    try {
      const r = await intakeLead(parsed.data);
      const { data, error } = await crm.from("leads").select(LEAD_SELECT).eq("id", r.lead_id).single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(data, { status: 201 });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Intake failed" }, { status: 500 });
    }
  }

  const { data, error } = await crm.from("leads").insert(body).select(LEAD_SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
