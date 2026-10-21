import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const state = {
  intake: vi.fn(),
  inserts: [] as { table: string; row: Record<string, unknown> }[],
};

vi.mock("@/lib/intake/client", () => ({ intakeLead: (...a: unknown[]) => state.intake(...a) }));
vi.mock("@/lib/discovery/server", () => ({
  defaultTemplateId: async () => "t1",
  snapshotFromTemplate: async () => ({ sections: [] }),
}));
vi.mock("@/lib/discovery", () => ({ discoveryLink: (t: string) => `http://x/d/${t}` }));
vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      from: (table: string) => ({
        update: () => { const u: Record<string, unknown> = {}; u.eq = () => u; u.is = async () => ({ error: null }); return u; },
        insert: (row: Record<string, unknown>) => {
          state.inserts.push({ table, row });
          const r = { data: { id: "inv1", token: "tok", lead_id: row.lead_id }, error: null };
          const b: Record<string, unknown> = {};
          b.select = () => ({ single: async () => r });
          b.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res);
          return b;
        },
      }),
    }),
  },
}));

import { POST } from "./route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const base = {
  org: { name: "Helping Hands" },
  contact: { first_name: "Pat", last_name: "Lee", email: "pat@hh.org" },
  project_title: "Donor CRM",
  project_type: "fundraising",
};

beforeEach(() => {
  state.inserts = [];
  state.intake = vi.fn().mockResolvedValue({
    contact_id: "c-existing", business_id: "b-existing", lead_id: "l-existing", created_contact: false, created_lead: false,
  });
});

describe("POST /api/crm/discovery", () => {
  it("taproot_reuses_existing_contact", async () => {
    const res = await POST(req({ ...base, engagement_type: "pro_bono" }));
    expect(res.status).toBe(201);
    expect(state.intake).toHaveBeenCalledWith({
      channel: "taproot", email: "pat@hh.org", name: "Pat Lee", org: "Helping Hands",
      stage: "qualification", summary: "Donor CRM",
      payload: { project_type: "fundraising", engagement_type: "pro_bono" },
    });
    const invite = state.inserts.find(i => i.table === "discovery_invites")!.row;
    expect(invite).toMatchObject({ lead_id: "l-existing", business_id: "b-existing", contact_id: "c-existing" });
    expect(state.inserts.some(i => i.table === "businesses" || i.table === "contacts" || i.table === "leads")).toBe(false);
  });

  it("uses the manual channel for paid engagements", async () => {
    await POST(req({ ...base, engagement_type: "paid" }));
    expect(state.intake.mock.calls[0][0]).toMatchObject({ channel: "manual" });
  });

  it("returns 500 when intake fails", async () => {
    state.intake = vi.fn().mockRejectedValue(new Error("boom"));
    const res = await POST(req({ ...base, engagement_type: "pro_bono" }));
    expect(res.status).toBe(500);
    expect(state.inserts).toEqual([]);
  });
});
