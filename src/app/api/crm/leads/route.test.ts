import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const state = {
  intake: vi.fn(),
  inserts: [] as Record<string, unknown>[],
  contact: null as Record<string, unknown> | null,
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
        const b: Record<string, unknown> = {};
        b.insert = (row: Record<string, unknown>) => { state.inserts.push(row); return b; };
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
});
