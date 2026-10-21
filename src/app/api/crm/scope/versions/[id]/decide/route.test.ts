import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  rpcError: null as { code?: string; message: string } | null,
  rpcs: [] as string[],
  version: { id: "v1", status: "proposed", change_note: "Riley says" } as Record<string, unknown> | null,
  updates: [] as { patch: Record<string, unknown>; eqs: [string, unknown][] }[],
  updatedRows: [{ id: "v1" }] as unknown[],
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      rpc: async (fn: string) => { s.rpcs.push(fn); return { data: null, error: s.rpcError }; },
      from: () => {
        const eqs: [string, unknown][] = [];
        let patch: Record<string, unknown> | null = null;
        const b: Record<string, unknown> = {};
        b.select = () => (patch ? Promise.resolve({ data: s.updatedRows, error: null }) : b);
        b.eq = (k: string, v: unknown) => { eqs.push([k, v]); return b; };
        b.maybeSingle = async () => ({ data: s.version, error: null });
        b.update = (p: Record<string, unknown>) => { patch = p; s.updates.push({ patch: p, eqs }); return b; };
        return b;
      },
    }),
  },
}));
vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));

import { POST } from "./route";

const ctx = { params: Promise.resolve({ id: "v1" }) };
const post = (body: unknown) => new NextRequest("http://x/api/crm/scope/versions/v1/decide", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  s.rpcError = null; s.rpcs = []; s.updates = []; s.updatedRows = [{ id: "v1" }];
  s.version = { id: "v1", status: "proposed", change_note: "Riley says" };
});

describe("POST /api/crm/scope/versions/:id/decide", () => {
  it("accepts via the rpc", async () => {
    expect((await POST(post({ decision: "accept" }), ctx)).status).toBe(200);
    expect(s.rpcs).toEqual(["accept_scope_version"]);
  });
  it("accept_stale_proposal_returns_409", async () => {
    s.rpcError = { code: "SC001", message: "stale proposal" };
    expect((await POST(post({ decision: "accept" }), ctx)).status).toBe(409);
  });
  it("accept of a non-proposed version returns 409", async () => {
    s.rpcError = { code: "SC002", message: "not proposed" };
    expect((await POST(post({ decision: "accept" }), ctx)).status).toBe(409);
  });
  it("SC003 is 404", async () => {
    s.rpcError = { code: "SC003", message: "scope version not found" };
    expect((await POST(post({ decision: "accept" }), ctx)).status).toBe(404);
  });
  it("unknown rpc errors are a generic 500 without details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    s.rpcError = { code: "XX000", message: "secret db detail" };
    const res = await POST(post({ decision: "accept" }), ctx);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal error" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it("reject_marks_rejected_with_note", async () => {
    const res = await POST(post({ decision: "reject", note: "too vague" }), ctx);
    expect(res.status).toBe(200);
    expect(s.updates).toHaveLength(1);
    expect(s.updates[0].patch).toMatchObject({ status: "rejected", change_note: "Riley says\nRejected by brian: too vague" });
    expect(typeof s.updates[0].patch.decided_at).toBe("string");
    expect(s.updates[0].eqs).toEqual([["id", "v1"], ["status", "proposed"]]);
    expect(s.rpcs).toEqual([]);
  });
  it("reject with no matching proposed row returns 409", async () => {
    s.updatedRows = [];
    expect((await POST(post({ decision: "reject" }), ctx)).status).toBe(409);
  });
  it("rejects bad decision with 400", async () => {
    expect((await POST(post({ decision: "maybe" }), ctx)).status).toBe(400);
  });
});
