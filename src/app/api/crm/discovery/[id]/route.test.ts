import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  invite: null as Record<string, unknown> | null,
  deleted: [] as { id: string }[],
  deleteCalls: [] as [string, unknown][][],
  inserts: [] as { table: string; row: Record<string, unknown> }[],
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      from: (table: string) => {
        const eqs: [string, unknown][] = [];
        let deleting = false;
        const b: Record<string, unknown> = {};
        b.select = () => (deleting ? Promise.resolve({ data: s.deleted, error: null }) : b);
        b.eq = (k: string, v: unknown) => { eqs.push([k, v]); return b; };
        b.maybeSingle = async () => ({ data: s.invite, error: null });
        b.delete = () => { deleting = true; s.deleteCalls.push(eqs); return b; };
        b.insert = (row: Record<string, unknown>) => {
          s.inserts.push({ table, row });
          return Promise.resolve({ error: null });
        };
        return b;
      },
    }),
  },
}));

import { DELETE } from "./route";

// Routes check permissions themselves; these tests exercise the handler logic as an admin.
vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));
vi.mock("@/lib/requireAdmin", () => ({ requireAdmin: async () => ({ ok: true, username: "brian" }) }));

const ID = "3e9c4f31-5a6d-4e8f-9aa1-2c3d4e5f6071";
const ctx = { params: Promise.resolve({ id: ID }) };
const req = () => new NextRequest(`http://x/api/crm/discovery/${ID}`, { method: "DELETE" });

beforeEach(() => {
  s.inserts = [];
  s.deleteCalls = [];
  s.deleted = [{ id: ID }];
  s.invite = { id: ID, lead_id: "lead1", project_title: "Intake", status: "submitted", response: [{ id: "r1" }] };
});

describe("DELETE /api/crm/discovery/:id", () => {
  it("deletes a sent invite with answers and logs it on the lead", async () => {
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(200);
    expect(s.deleteCalls).toEqual([[["id", ID]]]);  // no status filter: any status can be deleted
    expect(s.inserts).toEqual([{
      table: "lead_activities",
      row: expect.objectContaining({
        lead_id: "lead1",
        activity_type: "system",
        content: "Discovery questionnaire deleted: Intake",
        metadata: { deleted_discovery_invite_id: ID, status: "submitted", had_response: true },
      }),
    }]);
    // Must not look like a live invite's timeline entry.
    expect(s.inserts[0].row.metadata).not.toHaveProperty("discovery_invite_id");
  });

  it("deletes a draft without a response", async () => {
    s.invite = { ...s.invite!, status: "draft", response: [] };
    expect((await DELETE(req(), ctx)).status).toBe(200);
    expect(s.inserts[0].row.metadata).toMatchObject({ status: "draft", had_response: false });
  });

  it("404s for a missing invite and deletes nothing", async () => {
    s.invite = null;
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(404);
    expect(s.deleteCalls).toEqual([]);
    expect(s.inserts).toEqual([]);
  });
});
