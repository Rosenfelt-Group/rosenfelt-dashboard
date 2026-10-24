import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  guard: { ok: true } as { ok: boolean; response?: Response },
  perms: [] as string[],
  calls: [] as { table: string; op: string; args: unknown[] }[],
  tables: {} as Record<string, unknown[]>,
  errors: {} as Record<string, { message: string }>,
}));

vi.mock("@/lib/requirePermission", () => ({ requirePermission: async (_r: unknown, p: string) => { s.perms.push(p); return s.guard; } }));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      from: (table: string) => {
        const b: Record<string, unknown> = {};
        for (const op of ["select", "is", "or", "order", "limit"]) b[op] = (...args: unknown[]) => { s.calls.push({ table, op, args }); return b; };
        b.then = (res: (v: unknown) => void) => res({ data: s.errors[table] ? null : s.tables[table] ?? [], error: s.errors[table] ?? null });
        return b;
      },
    }),
  },
}));

import { GET } from "./route";

const B1 = "11111111-1111-4111-8111-111111111111";
const C1 = "22222222-2222-4222-8222-222222222222";
const L1 = "33333333-3333-4333-8333-333333333333";
const get = (qs: string) => GET(new NextRequest(`http://x/api/crm/search${qs}`));
const callsFor = (table: string, op: string) => s.calls.filter(c => c.table === table && c.op === op);

beforeEach(() => {
  s.guard = { ok: true };
  s.perms = [];
  s.calls = [];
  s.errors = {};
  s.tables = {
    businesses: [{ id: B1, name: "Harbor Light", website: "harborlight.org" }],
    contacts: [{ id: C1, first_name: "Dana", last_name: "Whitfield", email: "dana@harborlight.org", business: { id: B1, name: "Harbor Light" } }],
    leads: [{ id: L1, stage: "proposal", estimated_value: 2500, business: { id: B1, name: "Harbor Light" }, contact: { first_name: "Dana", last_name: "Whitfield" } }],
  };
});

describe("GET /api/crm/search", () => {
  it("requires view_crm", async () => {
    s.guard = { ok: false, response: new Response(null, { status: 403 }) };
    expect((await get("?q=harbor")).status).toBe(403);
    expect(s.perms).toEqual(["view_crm"]);
  });

  it.each(["", "?q=", "?q=a", "?q=%20%20", "?q=(),*"])("returns empty groups without querying for %s", async qs => {
    const res = await get(qs);
    expect(await res.json()).toEqual({ organizations: [], people: [], deals: [] });
    expect(s.calls).toHaveLength(0);
  });

  it("searches organizations, people and deals, leaving out soft-deleted rows", async () => {
    const res = await get("?q=harbor");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.organizations).toEqual([{ id: B1, label: "Harbor Light", detail: "harborlight.org", href: `/crm/organizations/${B1}` }]);
    expect(body.people).toEqual([{ id: C1, label: "Dana Whitfield", detail: "Harbor Light · dana@harborlight.org", href: `/crm/people/${C1}` }]);
    expect(body.deals).toEqual([{ id: L1, label: "Harbor Light — Dana Whitfield", detail: "Proposal · $2,500", href: `/crm/leads/${L1}` }]);
    for (const t of ["businesses", "contacts", "leads"]) expect(callsFor(t, "is")).toContainEqual({ table: t, op: "is", args: ["deleted_at", null] });
  });

  it("finds deals through the matching organizations and people", async () => {
    await get("?q=harbor");
    expect(callsFor("leads", "or")[0].args[0]).toBe(`business_id.in.(${B1}),contact_id.in.(${C1})`);
  });

  it("skips the deal query when nothing matched", async () => {
    s.tables.businesses = [];
    s.tables.contacts = [];
    const body = await (await get("?q=nobody")).json();
    expect(body).toEqual({ organizations: [], people: [], deals: [] });
    expect(callsFor("leads", "select")).toHaveLength(0);
  });

  it("sanitizes the term before it reaches the filter", async () => {
    await get("?q=" + encodeURIComponent("harbor),deleted_at.not.is.null,(x"));
    const filter = callsFor("businesses", "or")[0].args[0] as string;
    expect(filter.split(",")).toHaveLength(3);
    expect(filter).not.toMatch(/[()]/);
  });

  it("clamps the limit", async () => {
    s.tables.businesses = Array.from({ length: 25 }, (_, i) => ({ id: `b${i}`, name: `Org ${i}`, website: null }));
    expect((await (await get("?q=org&limit=999")).json()).organizations).toHaveLength(20);
    expect((await (await get("?q=org&limit=nope")).json()).organizations).toHaveLength(5);
    expect(callsFor("leads", "limit").map(c => c.args[0])).toEqual([20, 5]);
  });

  it("returns 500 when a lookup fails", async () => {
    s.errors.contacts = { message: "boom" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get("?q=harbor");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Search failed" });
  });
});
