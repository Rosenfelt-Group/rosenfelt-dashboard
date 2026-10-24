import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  invite: null as Record<string, unknown> | null,
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  rpcError: null as { code: string; message: string } | null,
  deleteCalls: 0,
  inserts: [] as { table: string; row: Record<string, unknown> }[],
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        s.rpcs.push({ fn, args });
        return { data: s.rpcError ? null : { kind: args.p_kind, id: args.p_id }, error: s.rpcError };
      },
      from: (table: string) => {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.maybeSingle = async () => ({ data: s.invite, error: null });
        b.delete = () => { s.deleteCalls++; return b; };
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
  s.deleteCalls = 0;
  s.rpcs = [];
  s.rpcError = null;
  s.invite = { id: ID, lead_id: "lead1", project_title: "Intake", status: "submitted", response: [{ id: "r1" }] };
});

describe("DELETE /api/crm/discovery/:id", () => {
  it("moves a sent invite with answers to Trash and logs it on the lead", async () => {
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(200);
    expect(s.deleteCalls).toBe(0); // soft delete only
    expect(s.rpcs).toEqual([{ fn: "soft_delete", args: { p_kind: "discovery_invite", p_id: ID, p_by: "brian" } }]);
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
    expect(s.rpcs).toEqual([]);
    expect(s.inserts).toEqual([]);
  });

  it("409s when it is already in Trash and logs nothing", async () => {
    s.rpcError = { code: "TR003", message: "discovery_invite x is already in Trash" };
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "TR003", error: "Already in Trash" });
    expect(s.inserts).toEqual([]);
  });

  it("400s for a non-uuid id", async () => {
    expect((await DELETE(req(), { params: Promise.resolve({ id: "nope" }) })).status).toBe(400);
    expect(s.rpcs).toEqual([]);
  });
});
