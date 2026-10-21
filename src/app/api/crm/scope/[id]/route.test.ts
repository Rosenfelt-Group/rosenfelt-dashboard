import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  doc: { id: "d1", title: "Scope" } as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => { s.rpcs.push({ fn, args }); return { data: "v-new", error: null }; },
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
const sec = { key: "goals", title: "Goals", body_md: "Grow", visibility: "client" };

beforeEach(() => { s.rpcs = []; s.doc = { id: "d1" }; });

describe("PATCH /api/crm/scope/:id", () => {
  it("edit_creates_new_current_version", async () => {
    const res = await PATCH(patch({ sections: [sec], change_note: "tweak" }), ctx);
    expect(res.status).toBe(200);
    expect(s.rpcs).toEqual([{
      fn: "create_scope_version_current",
      args: { p_doc_id: "d1", p_sections: [sec], p_source: "brian", p_created_by: "brian", p_change_note: "tweak" },
    }]);
  });
  it("rejects invalid sections with 400 and no rpc", async () => {
    for (const bad of [[{ ...sec, key: "" }], [{ ...sec, visibility: "public" }], [{ ...sec, body_md: 5 }], Array(51).fill(sec), [{ ...sec, body_md: "x".repeat(201 * 1024) }]]) {
      const res = await PATCH(patch({ sections: bad }), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBeTruthy();
    }
    expect(s.rpcs).toEqual([]);
  });
  it("404 for unknown document", async () => {
    s.doc = null;
    expect((await PATCH(patch({ sections: [sec] }), ctx)).status).toBe(404);
  });
});
