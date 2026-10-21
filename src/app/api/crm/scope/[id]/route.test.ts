import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  doc: { id: "d1", current_version_id: "11111111-1111-4111-8111-111111111111" } as Record<string, unknown> | null,
  rpcError: null as { code?: string; message: string } | null,
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => { s.rpcs.push({ fn, args }); return { data: "v-new", error: s.rpcError }; },
      from: () => {
        const b: Record<string, unknown> = {};
        b.select = () => b; b.eq = () => b; b.order = () => Promise.resolve({ data: [], error: null });
        b.maybeSingle = async () => ({ data: s.doc, error: null });
        return b;
      },
    }),
  },
}));
vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));

import { PATCH } from "./route";

const ctx = { params: Promise.resolve({ id: "d1" }) };
const patch = (body: unknown) => new NextRequest("http://x/api/crm/scope/d1", { method: "PATCH", body: JSON.stringify(body) });
const CUR = "11111111-1111-4111-8111-111111111111";
const sec = { key: "goals", title: "Goals", body_md: "Grow", visibility: "client" };

beforeEach(() => { s.rpcs = []; s.rpcError = null; s.doc = { id: "d1", current_version_id: CUR }; });

describe("PATCH /api/crm/scope/:id", () => {
  it("edit_creates_new_current_version", async () => {
    const res = await PATCH(patch({ sections: [sec], change_note: "tweak", based_on_version_id: CUR }), ctx);
    expect(res.status).toBe(200);
    expect(s.rpcs).toEqual([{
      fn: "create_scope_version_current",
      args: { p_doc_id: "d1", p_sections: [sec], p_source: "brian", p_created_by: "brian", p_change_note: "tweak", p_based_on: CUR },
    }]);
  });
  it("rejects invalid sections with 400 and no rpc", async () => {
    for (const bad of [[{ ...sec, key: "" }], [{ ...sec, visibility: "public" }], [{ ...sec, body_md: 5 }], Array(51).fill(sec), [{ ...sec, body_md: "x".repeat(201 * 1024) }]]) {
      const res = await PATCH(patch({ sections: bad, based_on_version_id: CUR }), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBeTruthy();
    }
    expect(s.rpcs).toEqual([]);
  });
  it("404 for unknown document", async () => {
    s.doc = null;
    expect((await PATCH(patch({ sections: [sec], based_on_version_id: CUR }), ctx)).status).toBe(404);
  });
  it("stale_edit_returns_409", async () => {
    const res = await PATCH(patch({ sections: [sec], based_on_version_id: "22222222-2222-4222-8222-222222222222" }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Scope changed since you loaded it");
    expect(s.rpcs).toEqual([]);
  });
  it("race: rpc SC001 is also 409", async () => {
    s.rpcError = { code: "SC001", message: "stale edit" };
    expect((await PATCH(patch({ sections: [sec], based_on_version_id: CUR }), ctx)).status).toBe(409);
  });
  it("requires based_on_version_id", async () => {
    expect((await PATCH(patch({ sections: [sec] }), ctx)).status).toBe(400);
  });
});
