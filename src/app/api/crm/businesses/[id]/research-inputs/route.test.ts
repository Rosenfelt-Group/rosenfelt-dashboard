import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { FakeDb } from "@/lib/research/test-fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as { client: () => unknown } }));
vi.mock("@/lib/supabase-admin", () => ({ get supabaseAdmin() { return h.db.client(); } }));
vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));

import { PUT } from "./route";
import { GET, POST } from "../research/route";

const B = "11111111-1111-4111-8111-111111111111";
const N1 = "33333333-3333-4333-8333-333333333331";
const L1 = "44444444-4444-4444-8444-444444444441";
const ctx = { params: Promise.resolve({ id: B }) };
const put = (body: unknown) => new NextRequest(`http://x/api/crm/businesses/${B}/research-inputs`, { method: "PUT", body: JSON.stringify(body) });
let db: FakeDb;

beforeEach(() => {
  db = new FakeDb();
  h.db = db;
  db.tables.businesses = [{ id: B, name: "Eastside Youth Arts" }];
  db.tables.business_research = [{ id: N1, business_id: B, summary: "Waitlist", details: null, created_at: "2026-10-12" }];
  db.tables.research_briefs = [{ id: L1, topic: "SMS tools", research_type: "tool", created_at: "2026-10-09" }];
  db.tables.research_brief_links = [{ brief_id: L1, business_id: B, created_at: "2026-10-14" }];
  db.tables.scope_research_inputs = [];
});

describe("PUT /api/crm/businesses/:id/research-inputs", () => {
  it("saves the ticks and returns the research with selected flags", async () => {
    const res = await PUT(put({ items: [{ type: "note", id: N1, selected: true }, { type: "brief", id: L1, selected: true }] }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.selected_count).toBe(2);
    expect(body.notes[0].selected && body.briefs[0].selected).toBe(true);
  });

  it("rejects bad bodies and foreign items", async () => {
    expect((await PUT(put({ items: [] }), ctx)).status).toBe(400);
    expect((await PUT(put({ items: [{ type: "doc", id: N1, selected: true }] }), ctx)).status).toBe(400);
    expect((await PUT(put({ items: [{ type: "brief", id: "55555555-5555-4555-8555-555555555555", selected: true }] }), ctx)).status).toBe(400);
    expect(db.tables.scope_research_inputs).toHaveLength(0);
  });

  it("404s for a missing or deleted organization", async () => {
    db.tables.businesses[0].deleted_at = "2026-10-20";
    expect((await PUT(put({ items: [{ type: "note", id: N1, selected: true }] }), ctx)).status).toBe(404);
  });
});

describe("/api/crm/businesses/:id/research", () => {
  it("GET returns notes and linked briefs, nothing selected by default", async () => {
    const body = await (await GET(new NextRequest("http://x"), ctx)).json();
    expect(body).toMatchObject({ business_id: B, selected_count: 0, total: 2 });
    expect(body.notes[0]).toMatchObject({ id: N1, type: "note", selected: false });
    expect(body.briefs[0]).toMatchObject({ id: L1, type: "brief", selected: false });
  });

  it("POST {note} saves Brian's own note", async () => {
    const res = await POST(new NextRequest("http://x", { method: "POST", body: JSON.stringify({ note: " Board wants SMS " }) }), ctx);
    expect(res.status).toBe(201);
    expect(db.tables.business_research.at(-1)).toMatchObject({ business_id: B, summary: "Board wants SMS", source: "manual", researched_by: "brian" });
  });

  it("POST needs a note or a topic", async () => {
    expect((await POST(new NextRequest("http://x", { method: "POST", body: "{}" }), ctx)).status).toBe(400);
  });
});
