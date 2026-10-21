import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const state = {
  intake: vi.fn(),
  inserts: [] as Record<string, unknown>[],
  contact: null as Record<string, unknown> | null,
  tables: [] as string[],
  updates: [] as Record<string, unknown>[],
};
vi.mock("@/lib/intake/client", () => ({
  intakeLead: (...a: unknown[]) => state.intake(...a),
  IntakeError: class IntakeError extends Error {},
}));
vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      from: (table: string) => {
        state.tables.push(table);
        const b: Record<string, unknown> = {};
        b.insert = (row: Record<string, unknown>) => { state.inserts.push(row); return b; };
        b.update = (row: Record<string, unknown>) => { state.updates.push(row); return b; };
        b.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res);
        b.select = () => b;
        b.eq = () => b;
        b.single = async () => ({ data: table === "contacts" ? state.contact : { id: "l1", table }, error: null });
        return b;
      },
    }),
  },
}));

import { POST } from "./route";

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;

beforeEach(() => {
  state.inserts = [];
  state.tables = [];
  state.updates = [];
  state.contact = { first_name: "Pat", last_name: "Lee", email: "pat@hh.org" };
  state.intake = vi.fn().mockResolvedValue({ contact_id: "c", business_id: "b", lead_id: "l1", created_contact: false, created_lead: true });
});

describe("POST /api/crm/leads", () => {
  it("routes email leads through intakeLead", async () => {
    const res = await POST(req({ email: "pat@hh.org", first_name: "Pat", source: "referral", stage: "new", estimated_value: 500 }));
    expect(res.status).toBe(201);
    expect(state.intake).toHaveBeenCalledWith(expect.objectContaining({ channel: "referral", email: "pat@hh.org", stage: "new", estimated_value: 500 }));
    expect(state.inserts).toEqual([]);
  });

  it("resolves the email from contact_id and defaults the channel to manual", async () => {
    await POST(req({ business_id: "b", contact_id: "c", stage: "new" }));
    expect(state.intake).toHaveBeenCalledWith(expect.objectContaining({ channel: "manual", email: "pat@hh.org", name: "Pat Lee" }));
  });

  it("falls back to a direct insert when there is no email", async () => {
    state.contact = { first_name: "Pat", last_name: null, email: null };
    const body = { business_id: "b", contact_id: "c", stage: "new", source: "manual" };
    const res = await POST(req(body));
    expect(res.status).toBe(201);
    expect(state.intake).not.toHaveBeenCalled();
    expect(state.inserts).toEqual([body]);
  });

  it("returns 400 for an invalid channel", async () => {
    const res = await POST(req({ email: "pat@hh.org", source: "bogus" }));
    expect(res.status).toBe(400);
    expect(state.intake).not.toHaveBeenCalled();
  });

  it("new_contact_lead_goes_through_intake", async () => {
    const res = await POST(req({ email: "new@hh.org", first_name: "New", last_name: "Person", org: "HH", phone: "555", source: "referral", stage: "new" }));
    expect(res.status).toBe(201);
    expect(state.intake).toHaveBeenCalledWith(expect.objectContaining({
      channel: "referral", email: "new@hh.org", name: "New Person", org: "HH", phone: "555",
    }));
  });

  it("existing_email_reuses_contact_no_orphan_business", async () => {
    await POST(req({ email: "pat@hh.org", first_name: "Pat", org: "Whatever", source: "manual" }));
    expect(state.inserts).toEqual([]);
    expect(state.tables).not.toContain("businesses");
    expect(state.tables).not.toContain("contacts");
  });

  it("intake_path_keeps_whitelisted_fields", async () => {
    await POST(req({ email: "pat@hh.org", entry_stage: "new", assigned_agent: "riley", close_date: "2026-12-01", quiz_url: "http://q", estimated_value: 900 }));
    expect(state.updates).toEqual([{ assigned_agent: "riley", close_date: "2026-12-01", quiz_url: "http://q", estimated_value: 900, entry_stage: "new" }]);
  });

  it("rejects unknown keys on both paths", async () => {
    expect((await POST(req({ email: "pat@hh.org", bogus: 1 }))).status).toBe(400);
    state.contact = { first_name: "P", last_name: null, email: null };
    expect((await POST(req({ contact_id: "c", bogus: 1 }))).status).toBe(400);
    expect(state.intake).not.toHaveBeenCalled();
    expect(state.inserts).toEqual([]);
  });

  it("requires an email for new-contact fields", async () => {
    expect((await POST(req({ first_name: "No", org: "X" }))).status).toBe(400);
  });
});
