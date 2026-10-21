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

// Lead columns a caller may set (stage is applied by intake, forward-only, on the intake path).
const LEAD_COLUMNS = ["business_id", "contact_id", "stage", "entry_stage", "source", "quiz_url", "assigned_agent", "estimated_value", "close_date", "lost_reason"] as const;
// Contact fields for a new contact; these only work with an email, via intake.
const CONTACT_FIELDS = ["email", "first_name", "last_name", "org", "phone"] as const;
const ALLOWED = new Set<string>([...LEAD_COLUMNS, ...CONTACT_FIELDS]);
// Applied to the lead after intake (stage, source and ids are owned by intake).
const POST_INTAKE = ["quiz_url", "assigned_agent", "estimated_value", "close_date", "lost_reason"] as const;

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

// Create a lead. When an email is known (sent directly, or on the contact), it goes through
// crm.intake_lead so contacts and open leads deduplicate by email, and no separate business or
// contact rows are written. Without an email, intake cannot be used, so the row is inserted directly.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Invalid input", 400);
  const unknown = Object.keys(body).filter(k => !ALLOWED.has(k));
  if (unknown.length) return fail(`Unknown field(s): ${unknown.join(", ")}`, 400);

  const crm = supabaseAdmin.schema("crm");
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

  let email = str(body.email);
  let name = [str(body.first_name), str(body.last_name)].filter(Boolean).join(" ") || undefined;
  if (!email && body.contact_id) {
    const { data: c } = await crm.from("contacts").select("first_name, last_name, email").eq("id", body.contact_id).single();
    email = str(c?.email);
    name = name ?? ([c?.first_name, c?.last_name].filter(Boolean).join(" ") || undefined);
  }

  const hasContactFields = CONTACT_FIELDS.some(k => k !== "email" && str(body[k]));
  if (!email && hasContactFields) return fail("An email is required to create a new contact", 400);

  if (email) {
    const parsed = IntakeSchema.safeParse({
      // IntakeSchema's CHANNELS enum rejects unknown sources with a 400 here.
      channel: body.source ?? "manual",
      email,
      name,
      org: str(body.org),
      phone: str(body.phone),
      stage: body.stage ?? undefined,
      entry_stage: body.entry_stage ?? undefined,
      estimated_value: body.estimated_value ?? undefined,
    });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input", 400);
    try {
      const r = await intakeLead(parsed.data);
      const extra: Record<string, unknown> = {};
      for (const k of POST_INTAKE) if (body[k] !== undefined && body[k] !== null) extra[k] = body[k];
      if (r.created_lead && body.entry_stage) extra.entry_stage = body.entry_stage;
      if (Object.keys(extra).length) {
        const { error: ue } = await crm.from("leads").update(extra).eq("id", r.lead_id);
        if (ue) return fail(ue.message, 500);
      }
      const { data, error } = await crm.from("leads").select(LEAD_SELECT).eq("id", r.lead_id).single();
      if (error) return fail(error.message, 500);
      return NextResponse.json(data, { status: 201 });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Intake failed", 500);
    }
  }

  const row = Object.fromEntries(LEAD_COLUMNS.filter(k => k in body).map(k => [k, body[k]]));
  const { data, error } = await crm.from("leads").insert(row).select(LEAD_SELECT).single();
  if (error) return fail(error.message, 500);
  return NextResponse.json(data, { status: 201 });
}
