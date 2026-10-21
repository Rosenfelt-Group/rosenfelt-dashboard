import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

type Result = { data: unknown; error: { message: string } | null };
const state = {
  engagements: { data: [], error: null } as Result,
  businesses: { data: [], error: null } as Result,
  calls: [] as { schema: string; table: string; ops: [string, unknown[]][] }[],
};

function chain(schema: string, table: string) {
  const call = { schema, table, ops: [] as [string, unknown[]][] };
  state.calls.push(call);
  const result = () => (table === "engagements" ? state.engagements : state.businesses);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "order", "eq", "in", "limit"]) {
    b[m] = (...args: unknown[]) => { call.ops.push([m, args]); return b; };
  }
  b.then = (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
  return b;
}

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { schema: (s: string) => ({ from: (t: string) => chain(s, t) }) },
}));

import { GET } from "./route";

// Routes check permissions themselves; these tests exercise the handler logic as an admin.
vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));
vi.mock("@/lib/requireAdmin", () => ({ requireAdmin: async () => ({ ok: true, username: "brian" }) }));

const req = (qs = "") =>
  ({ nextUrl: new URL(`http://x/api/engagements${qs}`) }) as unknown as NextRequest;
const eng = (id: string, business_id: string) => ({ id, business_id, title: id, relationship: "prospect", status: "active" });

beforeEach(() => {
  state.calls = [];
  state.engagements = { data: [], error: null };
  state.businesses = { data: [], error: null };
});

describe("GET /api/engagements", () => {
  it("attaches business names with one crm.businesses query", async () => {
    state.engagements = { data: [eng("e1", "b1"), eng("e2", "b1"), eng("e3", "b2")], error: null };
    state.businesses = { data: [{ id: "b1", name: "Acme" }, { id: "b2", name: "Beta" }], error: null };
    const res = await GET(req());
    const body = await res.json();
    expect(body.map((r: { business: unknown }) => r.business)).toEqual([
      { id: "b1", name: "Acme" }, { id: "b1", name: "Acme" }, { id: "b2", name: "Beta" },
    ]);
    expect(body[0].title).toBe("e1");
    const bq = state.calls.filter(c => c.table === "businesses");
    expect(bq).toHaveLength(1);
    expect(bq[0].schema).toBe("crm");
    const inOp = bq[0].ops.find(o => o[0] === "in")!;
    expect(inOp[1][0]).toBe("id");
    expect([...(inOp[1][1] as string[])].sort()).toEqual(["b1", "b2"]);
  });

  it("returns rows with business null when the lookup fails", async () => {
    state.engagements = { data: [eng("e1", "b1")], error: null };
    state.businesses = { data: null, error: { message: "boom" } };
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].business).toBeNull();
  });

  it("sets business null when the org is missing from the lookup", async () => {
    state.engagements = { data: [eng("e1", "b9")], error: null };
    const body = await (await GET(req())).json();
    expect(body[0].business).toBeNull();
  });

  it("makes no businesses query for an empty list", async () => {
    const res = await GET(req());
    expect(await res.json()).toEqual([]);
    expect(state.calls.some(c => c.table === "businesses")).toBe(false);
  });

  it("passes the business_id filter through", async () => {
    await GET(req("?business_id=b1"));
    const eq = state.calls.find(c => c.table === "engagements")!.ops.find(o => o[0] === "eq")!;
    expect(eq[1]).toEqual(["business_id", "b1"]);
  });

  it("applies limit (default 200, or the requested value)", async () => {
    await GET(req());
    await GET(req("?limit=5"));
    const lims = state.calls.filter(c => c.table === "engagements").map(c => c.ops.find(o => o[0] === "limit")![1][0]);
    expect(lims).toEqual([200, 5]);
  });

  it("500s when engagements fail", async () => {
    state.engagements = { data: null, error: { message: "nope" } };
    expect((await GET(req())).status).toBe(500);
  });
});
