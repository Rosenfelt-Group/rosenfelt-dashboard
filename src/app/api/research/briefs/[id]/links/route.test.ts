import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "@/lib/research/test-fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as { client: () => unknown }, allow: true }));
vi.mock("@/lib/supabase-admin", () => ({ get supabaseAdmin() { return h.db.client(); } }));
vi.mock("@/lib/requirePermission", () => ({
  requirePermission: async () => h.allow
    ? { ok: true, username: "brian", role: "admin" }
    : { ok: false, response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) },
}));

import { POST, DELETE } from "./route";
import { GET as LIST } from "../../route";

const BRIEF = "44444444-4444-4444-8444-444444444441";
const B = "11111111-1111-4111-8111-111111111111";
const ctx = { params: Promise.resolve({ id: BRIEF }) };
const req = (method: string, body: unknown) =>
  new NextRequest(`http://x/api/research/briefs/${BRIEF}/links`, { method, body: JSON.stringify(body) });
let db: FakeDb;

beforeEach(() => {
  h.allow = true;
  db = new FakeDb();
  h.db = db;
  db.tables.businesses = [{ id: B, name: "Eastside Youth Arts" }];
  db.tables.research_briefs = [{ id: BRIEF, topic: "SMS tools", research_type: "tool", created_at: "2026-10-09" }];
  db.tables.research_brief_links = [];
  db.tables.scope_research_inputs = [];
});

describe("/api/research/briefs/:id/links", () => {
  it("links a brief to an organization once", async () => {
    expect((await POST(req("POST", { business_id: B }), ctx)).status).toBe(201);
    expect((await POST(req("POST", { business_id: B }), ctx)).status).toBe(201);
    expect(db.tables.research_brief_links).toEqual([expect.objectContaining({ brief_id: BRIEF, business_id: B, linked_by: "brian" })]);
  });

  it("validates the body and the targets", async () => {
    expect((await POST(req("POST", { business_id: "nope" }), ctx)).status).toBe(400);
    expect((await POST(req("POST", { business_id: "22222222-2222-4222-8222-222222222222" }), ctx)).status).toBe(404);
    db.tables.research_briefs[0].deleted_at = "2026-10-20";
    expect((await POST(req("POST", { business_id: B }), ctx)).status).toBe(404);
    expect(db.tables.research_brief_links).toHaveLength(0);
  });

  it("requires manage_crm", async () => {
    h.allow = false;
    expect((await POST(req("POST", { business_id: B }), ctx)).status).toBe(403);
    expect((await DELETE(req("DELETE", { business_id: B }), ctx)).status).toBe(403);
  });

  it("unlinks", async () => {
    db.tables.research_brief_links = [{ brief_id: BRIEF, business_id: B }];
    expect((await DELETE(req("DELETE", { business_id: B }), ctx)).status).toBe(200);
    expect(db.tables.research_brief_links).toHaveLength(0);
  });

  it("the library list carries each brief's linked organizations and skips deleted ones", async () => {
    db.tables.research_briefs.push({ id: "gone", topic: "Old", research_type: "trend", deleted_at: "2026-10-20" });
    db.tables.businesses.push({ id: "b-gone", name: "Gone Org", deleted_at: "2026-10-20" });
    db.tables.research_brief_links = [{ brief_id: BRIEF, business_id: B }, { brief_id: BRIEF, business_id: "b-gone" }];
    const body = await (await LIST()).json();
    expect(body).toHaveLength(1);
    expect(body[0].links).toEqual([{ business_id: B, name: "Eastside Youth Arts" }]);
  });
});
