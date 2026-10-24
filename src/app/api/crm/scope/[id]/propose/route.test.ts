import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "@/lib/research/test-fake-db";

const h = vi.hoisted(() => ({
  db: null as unknown as { client: () => unknown },
  calls: [] as unknown[][],
  result: { ok: true, data: { status: "proposed", scope_version_id: "v2", change_note: "Added SMS", research_used: 1 } } as unknown,
}));
vi.mock("@/lib/supabase-admin", () => ({ get supabaseAdmin() { return h.db.client(); } }));
vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));
vi.mock("@/lib/riley/client", () => ({
  RileyNotConfiguredError: class extends Error {},
  requestScopeRevision: async (...a: unknown[]) => { h.calls.push(a); return h.result; },
}));

import { POST } from "./route";

const B = "11111111-1111-4111-8111-111111111111";
const N1 = "33333333-3333-4333-8333-333333333331";
const ctx = { params: Promise.resolve({ id: "doc1" }) };
const post = (body: unknown = {}) => POST(new NextRequest("http://x", { method: "POST", body: JSON.stringify(body) }), ctx);
let db: FakeDb;

beforeEach(() => {
  h.calls = [];
  h.result = { ok: true, data: { status: "proposed", scope_version_id: "v2", change_note: "Added SMS", research_used: 1 } };
  db = new FakeDb();
  h.db = db;
  db.tables.scope_documents = [{ id: "doc1", business_id: B, current_version_id: "v1" }];
  db.tables.business_research = [{ id: N1, business_id: B, summary: "Waitlist", created_at: "2026-10-12" }];
  db.tables.research_brief_links = [];
  db.tables.scope_research_inputs = [{ business_id: B, business_research_id: N1, research_brief_id: null }];
});

describe("POST /api/crm/scope/:id/propose", () => {
  it("asks Riley for a revision and returns the proposal", async () => {
    const res = await post({ instructions: "Focus on SMS" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "proposed", scope_version_id: "v2", change_note: "Added SMS", research_used: 1 });
    expect(h.calls).toEqual([["doc1", "Focus on SMS"]]);
  });

  it("refuses without selected research, without a current version, or for a missing scope", async () => {
    db.tables.scope_research_inputs = [];
    expect((await post()).status).toBe(409);
    db.tables.scope_documents[0].current_version_id = null;
    expect((await post()).status).toBe(409);
    db.tables.scope_documents = [];
    expect((await post()).status).toBe(404);
    expect(h.calls).toEqual([]);
  });

  it("maps Riley failures without leaking Riley's text", async () => {
    h.result = { ok: false, kind: "failed", status: 502 };
    const res = await post();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("Riley could not propose a revision. Try again.");
    h.result = { ok: false, kind: "conflict", status: 409 };
    expect((await post()).status).toBe(409);
  });
});
