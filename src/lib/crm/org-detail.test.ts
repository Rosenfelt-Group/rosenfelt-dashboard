import { describe, expect, it } from "vitest";
import { buildOrgDetail, type OrgRaw } from "./org-detail";

const T = "2026-10-25";
const NOW = new Date("2026-10-25T12:00:00Z");
const lead = (id: string, stage: string, created_at: string, extra = {}) => ({
  id, stage, estimated_value: 1000, close_date: null, source: "manual", created_at, updated_at: created_at, converted_at: null,
  lost_reason: null, next_step: null, next_step_due: null, contact: null, ...extra,
}) as OrgRaw["leads"][number];
const base = (): OrgRaw => ({
  business: { id: "b", name: "Org", industry: null, size: null, website: null, address: null, phone: null, email: null, source: null, notes: null, relationship: null, created_at: T, updated_at: T },
  people: [], leads: [], clients: [], invites: [], scopes: [], rooms: [], roomStats: [], research: { count: 0, latest: null },
});

describe("buildOrgDetail", () => {
  it("is a prospect with no client records", () => {
    const d = buildOrgDetail(base(), T, NOW);
    expect(d.status).toBe("prospect");
    expect(d.primary_client_id).toBeNull();
  });

  it("puts invites, scopes, rooms and the client record on the right deal", () => {
    const raw = base();
    raw.leads = [lead("won", "won", "2026-01-01"), lead("open", "proposal", "2026-09-01")];
    raw.clients = [{ id: "c", lead_id: null, contact_id: null, billing_status: "cancelled", contract_start: null, contract_end: null, stripe_customer_id: null, created_at: T, services: [{ id: "s", status: "pending_activation", monthly_rate: 100, project_rate: null, hourly_rate: null, service_template: { name: "Retainer", billing_type: "recurring" } }], contact: null }];
    raw.invites = [{ id: "i", lead_id: "open", project_title: "P", status: "sent", sent_at: "2026-10-20T00:00:00Z", opened_at: null, submitted_at: null, expires_at: "2026-12-01T00:00:00Z", created_at: "2026-10-19T00:00:00Z", contact: null, briefs: [] }];
    raw.scopes = [{ id: "sc", title: "S", lead_id: null, client_id: "c", engagement_type: null, delivery_model: null, current_version_no: 1, current_decided_at: null, proposals: [{ id: "v2", version_no: 2, created_at: "2026-10-22T00:00:00Z", created_by: "riley", change_note: null }] }];
    raw.rooms = [{ id: "r", title: "Room", relationship: "prospect", status: "active", lead_id: "open", client_id: null, created_at: T }, { id: "r2", title: "Loose", relationship: "client", status: "active", lead_id: null, client_id: null, created_at: T }];
    raw.roomStats = [{ engagement_id: "r", shared_versions: 1, active_links: 0, last_opened_at: null }];
    const d = buildOrgDetail(raw, T, NOW);
    expect(d.status).toBe("client");
    expect(d.primary_client_id).toBe("c");
    expect(d.deals.map((x) => x.id)).toEqual(["open", "won"]); // newest first
    const open = d.deals.find((x) => x.id === "open")!;
    const won = d.deals.find((x) => x.id === "won")!;
    expect(open.discovery.map((i) => i.id)).toEqual(["i"]);
    expect(open.rooms[0].shared_versions).toBe(1);
    expect(won.client_id).toBe("c"); // the only won deal gets the unlinked client record
    expect(won.scope).toBeNull(); // the scope's client has no lead, and two deals exist
    expect(d.other_scopes.map((s) => s.id)).toEqual(["sc"]);
    expect(d.other_rooms.map((r) => r.id)).toEqual(["r2"]);
    expect(d.upcoming.map((u) => u.kind)).toEqual(["discovery_waiting"]);
  });

  it("lists next steps and proposals as upcoming, and honours the override", () => {
    const raw = base();
    raw.business.relationship = "partner";
    raw.leads = [lead("l", "proposal", "2026-01-01", { next_step: "Call Dana", next_step_due: "2026-10-26" })];
    raw.scopes = [{ id: "sc", title: "S", lead_id: "l", client_id: null, engagement_type: null, delivery_model: null, current_version_no: 1, current_decided_at: null, proposals: [{ id: "v2", version_no: 2, created_at: "2026-10-22T00:00:00Z", created_by: "riley", change_note: null }] }];
    const d = buildOrgDetail(raw, T, NOW);
    expect(d.status).toBe("partner");
    expect(d.derived_status).toBe("prospect");
    expect(d.upcoming.map((u) => [u.kind, u.title])).toEqual([["next_step", "Call Dana"], ["scope_proposal", "Scope proposal v2 to review"]]);
  });
});
