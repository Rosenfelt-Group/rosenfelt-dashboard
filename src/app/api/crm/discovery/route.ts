import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { discoveryLink } from "@/lib/discovery";
import { defaultTemplateId, snapshotFromTemplate } from "@/lib/discovery/server";
import { requirePermission } from "@/lib/requirePermission";

const LIST_SELECT =
  "id, token, lead_id, project_title, project_type, engagement_type, template_id, status, sent_at, opened_at, last_saved_at, submitted_at, expires_at, created_at," +
  " business:businesses(id, name), contact:contacts(id, first_name, last_name, email), briefs:discovery_briefs(id, status, created_at)";

// GET /api/crm/discovery[?lead_id=…]
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const leadId = req.nextUrl.searchParams.get("lead_id");
  const businessId = req.nextUrl.searchParams.get("business_id");
  let q = supabaseAdmin.schema("crm").from("discovery_invites").select(LIST_SELECT).order("created_at", { ascending: false });
  if (leadId) q = q.eq("lead_id", leadId);
  if (businessId) q = q.eq("business_id", businessId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as unknown as ({ token: string } & Record<string, unknown>)[];
  return NextResponse.json(rows.map(i => ({ ...i, link: discoveryLink(i.token) })));
}

const CreateSchema = z.object({
  lead_id: z.string().uuid().optional(),
  org: z.object({ name: z.string().trim().min(1), website: z.string().trim().optional() }).optional(),
  contact: z.object({
    first_name: z.string().trim().min(1),
    last_name: z.string().trim().optional(),
    email: z.string().trim().email(),
  }).optional(),
  project_title: z.string().trim().min(1).max(200),
  project_brief: z.string().trim().max(10000).optional(),
  project_type: z.enum(["content_social", "operations", "fundraising", "data_reporting", "other"]),
  engagement_type: z.enum(["pro_bono", "paid"]).default("pro_bono"),
  expires_days: z.number().int().min(7).max(180).default(60),
  template_id: z.string().uuid().optional(),
}).refine(b => b.lead_id || (b.org && b.contact), { message: "Pick an existing lead or enter an organization and contact." });

// POST /api/crm/discovery — create a draft invite from a template, creating
// business/contact/lead first if needed. Nothing reaches the prospect until Send.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const parsed = CreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const b = parsed.data;
  const crm = supabaseAdmin.schema("crm");

  // Resolve the template before creating any CRM rows, so a bad template id leaves nothing behind.
  const templateId = b.template_id ?? await defaultTemplateId();
  if (!templateId) return NextResponse.json({ error: "No questionnaire template available" }, { status: 400 });
  const snapshot = await snapshotFromTemplate(templateId, b.project_type).catch(() => null);
  if (!snapshot) return NextResponse.json({ error: "Template not found" }, { status: 400 });

  let leadId = b.lead_id;
  let businessId: string | undefined;
  let contactId: string | undefined;

  if (leadId) {
    const { data: lead, error } = await crm.from("leads").select("id, business_id, contact_id").eq("id", leadId).single();
    if (error || !lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    businessId = lead.business_id ?? undefined;
    contactId = lead.contact_id ?? undefined;
  } else {
    const { data: biz, error: be } = await crm.from("businesses")
      .insert({ name: b.org!.name, website: b.org!.website || null, industry: "Nonprofit", source: b.engagement_type === "pro_bono" ? "pro_bono" : "manual" })
      .select("id").single();
    if (be) return NextResponse.json({ error: be.message }, { status: 500 });
    businessId = biz.id;

    const { data: contact, error: ce } = await crm.from("contacts")
      .insert({ business_id: businessId, first_name: b.contact!.first_name, last_name: b.contact!.last_name || null, email: b.contact!.email, is_primary: true })
      .select("id").single();
    if (ce) return NextResponse.json({ error: ce.message }, { status: 500 });
    contactId = contact.id;

    const { data: lead, error: le } = await crm.from("leads")
      .insert({ business_id: businessId, contact_id: contactId, stage: "qualification", entry_stage: "new", source: b.engagement_type === "pro_bono" ? "pro_bono" : "manual" })
      .select("id").single();
    if (le) return NextResponse.json({ error: le.message }, { status: 500 });
    leadId = lead.id;
  }

  const { data: invite, error } = await crm.from("discovery_invites").insert({
    lead_id: leadId,
    business_id: businessId ?? null,
    contact_id: contactId ?? null,
    project_title: b.project_title,
    project_brief: b.project_brief || null,
    project_type: b.project_type,
    engagement_type: b.engagement_type,
    status: "draft",
    sent_at: null,
    template_id: templateId,
    questionnaire_snapshot: snapshot,
    expires_at: new Date(Date.now() + b.expires_days * 86_400_000).toISOString(),
    created_by: "brian",
  }).select("id, token, lead_id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await crm.from("lead_activities").insert({
    lead_id: leadId,
    activity_type: "system",
    logged_by: "brian",
    content: `Discovery questionnaire drafted: ${b.project_title}`,
    metadata: { discovery_invite_id: invite.id },
  });

  return NextResponse.json({ ...invite, link: discoveryLink(invite.token) }, { status: 201 });
}
