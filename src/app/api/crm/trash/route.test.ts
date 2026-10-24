import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  result: { data: null as unknown, error: null as null | { code?: string; message: string; details?: string } },
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: { schema: () => ({ rpc: async (fn: string, args: Record<string, unknown>) => { s.rpcs.push({ fn, args }); return s.result; } }) },
}));
vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "jordan", role: "admin" }) }));

import { GET as listTrash } from "./route";
import { DELETE as purge } from "./[kind]/[id]/route";
import { POST as restore } from "./[kind]/[id]/restore/route";
import { POST as del } from "../delete/route";
import { GET as preview } from "../delete/preview/route";
import { DELETE as deleteLead } from "../leads/[id]/route";

const ID = "3e9c4f31-5a6d-4e8f-9aa1-2c3d4e5f6071";
const ctx = (kind: string, id = ID) => ({ params: Promise.resolve({ kind, id }) });
const post = (body: unknown) => new NextRequest("http://x/api/crm/delete", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const get = (q: string) => new NextRequest(`http://x/api/crm/delete/preview?${q}`);

beforeEach(() => { s.rpcs = []; s.result = { data: { ok: 1 }, error: null }; });

describe("POST /api/crm/delete", () => {
  it("soft deletes as the session user", async () => {
    const res = await del(post({ kind: "business", id: ID }));
    expect(res.status).toBe(200);
    expect(s.rpcs).toEqual([{ fn: "soft_delete", args: { p_kind: "business", p_id: ID, p_by: "jordan" } }]);
  });

  it("validates input before calling the database", async () => {
    for (const body of ["not json", { kind: "org", id: ID }, { kind: "business", id: "1" }, { id: ID }, []]) {
      expect((await del(post(body))).status).toBe(400);
    }
    expect(s.rpcs).toEqual([]);
  });

  it("returns the Stripe block as 409 with the services", async () => {
    s.result = { data: null, error: { code: "TR001", message: "billing", details: '[{"id":"s1"}]' } };
    const res = await del(post({ kind: "client", id: ID }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "TR001", services: [{ id: "s1" }] });
  });

  it("says already in Trash on TR003", async () => {
    s.result = { data: null, error: { code: "TR003", message: "x" } };
    const res = await del(post({ kind: "lead", id: ID }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Already in Trash");
  });
});

describe("GET /api/crm/delete/preview", () => {
  it("passes kind and id", async () => {
    expect((await preview(get(`kind=contact&id=${ID}`))).status).toBe(200);
    expect(s.rpcs).toEqual([{ fn: "delete_preview", args: { p_kind: "contact", p_id: ID } }]);
  });
  it("400s on bad input", async () => {
    expect((await preview(get(`kind=contact`))).status).toBe(400);
    expect((await preview(get(`kind=person&id=${ID}`))).status).toBe(400);
    expect(s.rpcs).toEqual([]);
  });
  it("404s when the record does not exist", async () => {
    s.result = { data: null, error: { code: "TR002", message: "x" } };
    expect((await preview(get(`kind=lead&id=${ID}`))).status).toBe(404);
  });
});

describe("Trash", () => {
  it("lists with the 30-day retention", async () => {
    s.result = { data: [], error: null };
    const res = await listTrash(new NextRequest("http://x/api/crm/trash"));
    expect(await res.json()).toEqual([]);
    expect(s.rpcs).toEqual([{ fn: "trash_items", args: { p_retention: "30 days" } }]);
  });

  it("restores and purges by kind and id", async () => {
    expect((await restore(new NextRequest("http://x", { method: "POST" }), ctx("engagement"))).status).toBe(200);
    expect((await purge(new NextRequest("http://x", { method: "DELETE" }), ctx("research_brief"))).status).toBe(200);
    expect(s.rpcs).toEqual([
      { fn: "restore_deleted", args: { p_kind: "engagement", p_id: ID } },
      { fn: "purge_deleted", args: { p_kind: "research_brief", p_id: ID } },
    ]);
  });

  it("maps restore and purge errors", async () => {
    s.result = { data: null, error: { code: "TR005", message: "x" } };
    expect((await restore(new NextRequest("http://x", { method: "POST" }), ctx("lead"))).status).toBe(409);
    s.result = { data: null, error: { code: "TR003", message: "x" } };
    const res = await purge(new NextRequest("http://x", { method: "DELETE" }), ctx("lead"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Not in Trash");
    s.result = { data: null, error: { code: "XX000", message: "secret internals" } };
    const bad = await purge(new NextRequest("http://x", { method: "DELETE" }), ctx("lead"));
    expect(bad.status).toBe(500);
    expect(await bad.json()).toEqual({ error: "Internal error" });
  });

  it("rejects bad route params", async () => {
    expect((await restore(new NextRequest("http://x", { method: "POST" }), ctx("nope"))).status).toBe(400);
    expect((await purge(new NextRequest("http://x", { method: "DELETE" }), ctx("lead", "x"))).status).toBe(400);
    expect(s.rpcs).toEqual([]);
  });
});

describe("DELETE /api/crm/leads/:id", () => {
  it("is a soft delete that returns 204", async () => {
    const res = await deleteLead(new NextRequest("http://x", { method: "DELETE" }), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(204);
    expect(s.rpcs).toEqual([{ fn: "soft_delete", args: { p_kind: "lead", p_id: ID, p_by: "jordan" } }]);
  });
  it("passes a TR003 through", async () => {
    s.result = { data: null, error: { code: "TR003", message: "x" } };
    expect((await deleteLead(new NextRequest("http://x", { method: "DELETE" }), { params: Promise.resolve({ id: ID }) })).status).toBe(409);
  });
});
