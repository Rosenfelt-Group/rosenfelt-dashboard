// The organization page's aggregate (GET /api/crm/organizations/[id]), assembled from plain rows so it can
// be tested without a database.
import type { CRMStage } from "@/types";
import { orgStatus, type OrgStatus } from "./org-status";
import { assignToDeals, isOpenDeal, type DealSummary, type InviteSummary, type RoomSummary, type ScopeSummary } from "./org-engagement";
import { sortUpcoming, type UpcomingItem } from "./org-timeline";

/** One row of GET /api/crm/organizations. */
export type OrgListRow = {
  id: string; name: string; industry: string | null; website: string | null; email: string | null; size: string | null;
  source: string | null; status: OrgStatus; relationship_override: string | null;
  people: number; clients: number; deals: number;
  open_deals: number; open_value: number;
  open_deal: { id: string; stage: CRMStage; estimated_value: number | null } | null;
  last_activity_at: string;
};

export type OrgBusiness = {
  id: string; name: string; industry: string | null; size: string | null; website: string | null; address: string | null;
  phone: string | null; email: string | null; source: string | null; notes: string | null; relationship: string | null;
  created_at: string; updated_at: string; deleted_at?: string | null;
};
export type OrgPerson = {
  id: string; first_name: string; last_name: string | null; email: string | null; phone: string | null; title: string | null;
  role: string | null; is_primary: boolean; linkedin_url: string | null; created_at: string;
};
export type OrgClientService = {
  id: string; status: string; monthly_rate: number | null; project_rate: number | null; hourly_rate: number | null;
  service_template: { name: string; billing_type: string } | null;
};
export type OrgClient = {
  id: string; lead_id: string | null; contact_id: string | null; billing_status: string; contract_start: string | null;
  contract_end: string | null; stripe_customer_id: string | null; created_at: string; services: OrgClientService[];
  contact: { id: string; first_name: string; last_name: string | null; email: string | null } | null;
};
export type OrgResearchSummary = { count: number; latest: { id: string; summary: string | null; researched_by: string | null; created_at: string } | null };

export type OrgDetail = {
  business: OrgBusiness;
  status: OrgStatus;
  derived_status: Exclude<OrgStatus, "partner">;
  people: OrgPerson[];
  deals: DealSummary[];
  clients: OrgClient[];
  /** The client record the Billing, Time and Work tabs open on: the live one, else the newest. */
  primary_client_id: string | null;
  /** Rooms and scopes that belong to the organization but to no single deal. */
  other_rooms: RoomSummary[];
  other_scopes: ScopeSummary[];
  research: OrgResearchSummary;
  upcoming: UpcomingItem[];
};

export type RawLead = {
  id: string; stage: CRMStage; estimated_value: number | null; close_date: string | null; source: string | null;
  created_at: string; updated_at: string; converted_at: string | null; lost_reason: string | null;
  next_step: string | null; next_step_due: string | null;
  contact: DealSummary["contact"];
};
export type RawInvite = Omit<InviteSummary, "brief_status"> & { lead_id: string | null; briefs: { status: string; created_at: string }[] | null };
export type RawRoom = Omit<RoomSummary, "shared_versions" | "active_links" | "last_opened_at"> & { client_id: string | null };
export type RawRoomStats = { engagement_id: string; shared_versions: number; active_links: number; last_opened_at: string | null };

export type OrgRaw = {
  business: OrgBusiness;
  people: OrgPerson[];
  leads: RawLead[];
  clients: OrgClient[];
  invites: RawInvite[];
  scopes: ScopeSummary[];
  rooms: RawRoom[];
  roomStats: RawRoomStats[];
  research: OrgResearchSummary;
};

const OPEN_INVITE = new Set(["sent", "opened", "in_progress"]);

export function buildOrgDetail(raw: OrgRaw, today: string, now = new Date()): OrgDetail {
  const stats = new Map(raw.roomStats.map((s) => [s.engagement_id, s]));
  const rooms: RoomSummary[] = raw.rooms.map((r) => ({
    id: r.id, title: r.title, relationship: r.relationship, status: r.status, lead_id: r.lead_id, created_at: r.created_at,
    shared_versions: stats.get(r.id)?.shared_versions ?? 0, active_links: stats.get(r.id)?.active_links ?? 0,
    last_opened_at: stats.get(r.id)?.last_opened_at ?? null,
  }));
  const dealIds = raw.leads.map((l) => l.id);
  const clientLead = new Map(raw.clients.map((c) => [c.id, c.lead_id]));
  // A scope tied to a client record belongs to the deal that client came from.
  const scopeRows = raw.scopes.map((s) => ({ ...s, lead_id: s.lead_id ?? (s.client_id ? clientLead.get(s.client_id) ?? null : null) }));
  const roomsBy = assignToDeals(rooms, dealIds);
  const scopesBy = assignToDeals(scopeRows, dealIds);
  const unlinkedClients = raw.clients.filter((c) => !c.lead_id);

  const deals: DealSummary[] = [...raw.leads].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((l) => {
    const linked = raw.clients.find((c) => c.lead_id === l.id);
    // Older client records were created without a lead; credit the only won deal with them.
    const client = linked ?? (l.stage === "won" && raw.leads.filter((x) => x.stage === "won").length === 1 ? unlinkedClients[0] : undefined);
    const scopes = scopesBy.byDeal.get(l.id) ?? [];
    return {
      ...l,
      discovery: raw.invites.filter((i) => i.lead_id === l.id).map(toInvite),
      // One scope per deal is the norm; any extras stay reachable under "other".
      scope: scopes[0] ?? null,
      rooms: roomsBy.byDeal.get(l.id) ?? [],
      client_id: client?.id ?? null,
    };
  });
  const extraScopes = [...scopesBy.byDeal.values()].flatMap((s) => s.slice(1));

  const clientStates = raw.clients.map((c) => ({ billing_status: c.billing_status, contract_end: c.contract_end, services: c.services }));
  const status = orgStatus(raw.business.relationship, clientStates, today);
  const derived = orgStatus(null, clientStates, today) as Exclude<OrgStatus, "partner">;
  const live = raw.clients.find((c) => orgStatus(null, [{ billing_status: c.billing_status, contract_end: c.contract_end, services: c.services }], today) === "client");
  const newestClient = [...raw.clients].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  return {
    business: raw.business,
    status,
    derived_status: derived,
    people: [...raw.people].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.first_name.localeCompare(b.first_name)),
    deals,
    clients: raw.clients,
    primary_client_id: (live ?? newestClient)?.id ?? null,
    other_rooms: roomsBy.unassigned,
    other_scopes: [...scopesBy.unassigned, ...extraScopes],
    research: raw.research,
    upcoming: upcomingFor(deals, today, now),
  };
}

function toInvite(i: RawInvite): InviteSummary {
  const brief = [...(i.briefs ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return {
    id: i.id, project_title: i.project_title, status: i.status, sent_at: i.sent_at, opened_at: i.opened_at,
    submitted_at: i.submitted_at, expires_at: i.expires_at, created_at: i.created_at, contact: i.contact,
    brief_status: brief?.status ?? null,
  };
}

export function upcomingFor(deals: DealSummary[], today: string, now = new Date()): UpcomingItem[] {
  const out: UpcomingItem[] = [];
  for (const d of deals) {
    if (isOpenDeal(d) && d.next_step) {
      out.push({ kind: "next_step", id: d.id, title: d.next_step, detail: d.next_step_due ? null : "No due date", at: d.next_step_due ?? d.updated_at, href: null, lead_id: d.id });
    }
    for (const p of d.scope?.proposals ?? []) {
      out.push({ kind: "scope_proposal", id: p.id, title: `Scope proposal v${p.version_no} to review`, detail: p.change_note ?? (p.created_by ? `From ${p.created_by}` : null), at: p.created_at, href: null, lead_id: d.id });
    }
    for (const i of d.discovery) {
      if (OPEN_INVITE.has(i.status) && Date.parse(i.expires_at) > now.getTime()) {
        out.push({ kind: "discovery_waiting", id: i.id, title: `Waiting on the questionnaire: ${i.project_title}`, detail: i.status === "sent" ? "Not opened yet" : i.status === "opened" ? "Opened, no answers saved" : "In progress", at: i.sent_at ?? i.created_at, href: `/crm/discovery/${i.id}`, lead_id: d.id });
      }
      if (i.status === "submitted" && i.brief_status === "ready" && !d.scope) {
        out.push({ kind: "brief_ready", id: i.id, title: `Brief ready: ${i.project_title}`, detail: "Read it before the call", at: i.submitted_at ?? i.created_at, href: `/crm/discovery/${i.id}`, lead_id: d.id });
      }
    }
    if (isOpenDeal(d) && d.close_date && d.close_date >= today) {
      out.push({ kind: "close_date", id: d.id, title: "Expected close", detail: d.estimated_value ? `$${Number(d.estimated_value).toLocaleString()}` : null, at: d.close_date, href: `/crm/leads/${d.id}`, lead_id: d.id });
    }
  }
  return sortUpcoming(out);
}
