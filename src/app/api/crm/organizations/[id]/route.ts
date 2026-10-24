import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { todayNY } from "@/lib/crm/org-status";
import { buildOrgDetail, type OrgClient, type OrgPerson, type RawInvite, type RawLead, type RawRoom, type RawRoomStats } from "@/lib/crm/org-detail";
import type { ScopeSummary } from "@/lib/crm/org-engagement";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHARED = ["shared", "approved", "changes_requested"];

/**
 * GET /api/crm/organizations/:id -> OrgDetail (src/lib/crm/org-detail.ts): the business, its status, people,
 * deals with their engagement state (discovery, scope, rooms, client record), client records with services,
 * research summary and upcoming items. Actions use the existing routes (businesses, contacts, leads,
 * discovery, scope, engagements, clients, client-services).
 * A business in Trash returns { business, deleted: true } so the page can offer Restore.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  const crm = supabaseAdmin.schema("crm");
  const rooms = supabaseAdmin.schema("rooms");

  const { data: business, error: bErr } = await crm.from("businesses").select("*").eq("id", id).maybeSingle();
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
  if (!business) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  if (business.deleted_at) return NextResponse.json({ business, deleted: true });

  const [people, leads, clients, scopes, engagements, research] = await Promise.all([
    crm.from("contacts").select("id, first_name, last_name, email, phone, title, role, is_primary, linkedin_url, created_at")
      .eq("business_id", id).is("deleted_at", null),
    crm.from("leads").select("id, stage, estimated_value, close_date, source, created_at, updated_at, converted_at, lost_reason, next_step, next_step_due, contact:contacts(id, first_name, last_name, email)")
      .eq("business_id", id).is("deleted_at", null),
    crm.from("clients").select("id, lead_id, contact_id, billing_status, contract_start, contract_end, stripe_customer_id, created_at," +
      " contact:contacts(id, first_name, last_name, email)," +
      " services:client_services(id, status, monthly_rate, project_rate, hourly_rate, service_template:service_templates(name, billing_type))")
      .eq("business_id", id).is("deleted_at", null),
    crm.from("scope_documents").select("id, title, lead_id, client_id, engagement_type, delivery_model, current_version_id, created_at")
      .eq("business_id", id).is("deleted_at", null).order("created_at"),
    rooms.from("engagements").select("id, title, relationship, status, lead_id, client_id, created_at")
      .eq("business_id", id).is("deleted_at", null).order("created_at", { ascending: false }),
    crm.from("business_research").select("id, summary, researched_by, created_at", { count: "exact" })
      .eq("business_id", id).is("deleted_at", null).order("created_at", { ascending: false }).limit(1),
  ]);
  const failed = [people, leads, clients, scopes, engagements, research].find((r) => r.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });

  const leadIds = (leads.data ?? []).map((l) => l.id);
  const scopeIds = (scopes.data ?? []).map((s) => s.id);
  const roomIds = (engagements.data ?? []).map((e) => e.id);
  const none = ["00000000-0000-0000-0000-000000000000"];

  const [invites, versions, deliverables, access, opened] = await Promise.all([
    crm.from("discovery_invites").select("id, lead_id, project_title, status, sent_at, opened_at, submitted_at, expires_at, created_at," +
      " contact:contacts(id, first_name, last_name, email), briefs:discovery_briefs(status, created_at)")
      .in("lead_id", leadIds.length ? leadIds : none).is("deleted_at", null).order("created_at", { ascending: false }),
    crm.from("scope_versions").select("id, scope_document_id, version_no, status, created_at, created_by, change_note, decided_at")
      .in("scope_document_id", scopeIds.length ? scopeIds : none),
    rooms.from("deliverables").select("id, engagement_id, versions:deliverable_versions(status)").in("engagement_id", roomIds.length ? roomIds : none),
    rooms.from("engagement_access").select("engagement_id").in("engagement_id", roomIds.length ? roomIds : none)
      .is("revoked_at", null).gt("expires_at", new Date().toISOString()),
    rooms.from("engagement_events").select("engagement_id, created_at").in("engagement_id", roomIds.length ? roomIds : none)
      .eq("type", "room_opened").order("created_at", { ascending: false }).limit(200),
  ]);
  const failed2 = [invites, versions, deliverables, access, opened].find((r) => r.error);
  if (failed2?.error) return NextResponse.json({ error: failed2.error.message }, { status: 500 });

  const scopeRows: ScopeSummary[] = (scopes.data ?? []).map((d) => {
    const vs = (versions.data ?? []).filter((v) => v.scope_document_id === d.id);
    const cur = vs.find((v) => v.id === d.current_version_id);
    return {
      id: d.id, title: d.title, lead_id: d.lead_id, client_id: d.client_id, engagement_type: d.engagement_type, delivery_model: d.delivery_model,
      current_version_no: cur?.version_no ?? null, current_decided_at: cur?.decided_at ?? null,
      proposals: vs.filter((v) => v.status === "proposed").sort((a, b) => a.version_no - b.version_no)
        .map((v) => ({ id: v.id, version_no: v.version_no, created_at: v.created_at, created_by: v.created_by, change_note: v.change_note })),
    };
  });

  const roomStats: RawRoomStats[] = roomIds.map((rid) => ({
    engagement_id: rid,
    shared_versions: (deliverables.data ?? []).filter((d) => d.engagement_id === rid)
      .flatMap((d) => (d.versions ?? []) as { status: string }[]).filter((v) => SHARED.includes(v.status)).length,
    active_links: (access.data ?? []).filter((a) => a.engagement_id === rid).length,
    last_opened_at: (opened.data ?? []).find((e) => e.engagement_id === rid)?.created_at ?? null,
  }));

  const detail = buildOrgDetail({
    business,
    people: (people.data ?? []) as OrgPerson[],
    leads: (leads.data ?? []) as unknown as RawLead[],
    clients: ((clients.data ?? []) as unknown as OrgClient[]).map((c) => ({ ...c, services: c.services ?? [] })),
    invites: (invites.data ?? []) as unknown as RawInvite[],
    scopes: scopeRows,
    rooms: (engagements.data ?? []) as RawRoom[],
    roomStats,
    research: { count: research.count ?? 0, latest: research.data?.[0] ?? null },
  }, todayNY());
  return NextResponse.json(detail);
}
