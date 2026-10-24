import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb } from "./test-fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as { client: () => unknown } }));
vi.mock("@/lib/supabase-admin", () => ({
  get supabaseAdmin() { return h.db.client(); },
}));

import { loadOrgResearch, ResearchError, runOrgResearch, setResearchInputs } from "./org-research";

const B = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const N1 = "33333333-3333-4333-8333-333333333331";
const N2 = "33333333-3333-4333-8333-333333333332";
const L1 = "44444444-4444-4444-8444-444444444441";
const DUP = "44444444-4444-4444-8444-444444444442";
let db: FakeDb;

beforeEach(() => {
  db = new FakeDb();
  h.db = db;
  db.tables.businesses = [{ id: B, name: "Eastside Youth Arts", deleted_at: null }];
  db.tables.business_research = [
    { id: N1, business_id: B, summary: "Waitlist in a Sheet", details: { doc_id: "167", storage_path: "unlinked/x.md" }, created_at: "2026-10-12", deleted_at: null },
    { id: N2, business_id: B, summary: "Deleted", details: null, created_at: "2026-10-13", deleted_at: "2026-10-20" },
    { id: "n-other", business_id: OTHER, summary: "Other org", details: null, created_at: "2026-10-01", deleted_at: null },
  ];
  db.tables.research_briefs = [
    { id: L1, topic: "SMS tools", research_type: "tool", doc_id: "130", created_at: "2026-10-09", deleted_at: null },
    { id: DUP, topic: "Eastside Youth Arts", research_type: "business", doc_id: "167", created_at: "2026-10-12", deleted_at: null },
    { id: "gone", topic: "Deleted brief", research_type: "trend", doc_id: null, created_at: "2026-10-01", deleted_at: "2026-10-02" },
  ];
  db.tables.research_brief_links = [
    { brief_id: L1, business_id: B, created_at: "2026-10-14" },
    { brief_id: DUP, business_id: B, created_at: "2026-10-12" },
    { brief_id: "gone", business_id: B, created_at: "2026-10-01" },
  ];
  db.tables.scope_research_inputs = [];
});

describe("loadOrgResearch", () => {
  it("returns live notes and linked briefs, nothing selected by default", async () => {
    const r = await loadOrgResearch(B);
    expect(r.notes.map(n => n.id)).toEqual([N1]);
    expect(r.briefs.map(b => b.id)).toEqual([L1]); // Avery's library copy of N1 and the deleted brief are hidden
    expect(r.notes[0]).toMatchObject({ type: "note", selected: false });
    expect(r.briefs[0]).toMatchObject({ type: "brief", selected: false, linked_at: "2026-10-14" });
    expect(r.selected_count).toBe(0);
    expect(r.total).toBe(2);
  });

  it("marks ticked items selected", async () => {
    db.tables.scope_research_inputs = [
      { business_id: B, business_research_id: N1, research_brief_id: null },
      { business_id: B, business_research_id: null, research_brief_id: L1 },
    ];
    const r = await loadOrgResearch(B);
    expect(r.notes[0].selected && r.briefs[0].selected).toBe(true);
    expect(r.selected_count).toBe(2);
  });

  it("surfaces load errors as a 500 ResearchError", async () => {
    db.errors.business_research = { message: "boom" };
    await expect(loadOrgResearch(B)).rejects.toMatchObject({ status: 500 });
  });
});

describe("setResearchInputs", () => {
  it("ticks and unticks notes and briefs", async () => {
    await setResearchInputs(B, [{ type: "note", id: N1, selected: true }, { type: "brief", id: L1, selected: true }], "brian");
    expect(db.tables.scope_research_inputs).toHaveLength(2);
    expect(db.tables.scope_research_inputs[0]).toMatchObject({ business_id: B, business_research_id: N1, added_by: "brian" });
    // ticking again does not duplicate
    await setResearchInputs(B, [{ type: "note", id: N1, selected: true }], "brian");
    expect(db.tables.scope_research_inputs).toHaveLength(2);
    await setResearchInputs(B, [{ type: "brief", id: L1, selected: false }], "brian");
    expect(db.tables.scope_research_inputs.map(r => r.business_research_id)).toEqual([N1]);
  });

  it("rejects another organization's note, a deleted note and an unlinked brief", async () => {
    for (const item of [
      { type: "note" as const, id: "n-other", selected: true },
      { type: "note" as const, id: N2, selected: true },
      { type: "brief" as const, id: "unlinked", selected: true },
    ]) {
      const p = setResearchInputs(B, [item], "brian");
      await expect(p).rejects.toBeInstanceOf(ResearchError);
      await expect(p).rejects.toMatchObject({ status: 400 });
    }
    expect(db.tables.scope_research_inputs).toHaveLength(0);
  });
});

describe("runOrgResearch", () => {
  beforeEach(() => {
    process.env.AVERY_AGENT_URL = "http://avery.test/";
    process.env.AVERY_WEBHOOK_SECRET = "s";
  });

  it("asks Avery for organization research and links Avery's library copy", async () => {
    db.tables.research_briefs.push({ id: "new-copy", topic: "Different topic", research_type: "business", doc_id: "200" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "row", details: { doc_id: "200" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const row = await runOrgResearch(B, "Eastside Youth Arts");
    expect(row.id).toBe("row");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://avery.test/research/run");
    expect(JSON.parse(init.body as string)).toEqual({ business_id: B, topic: "Eastside Youth Arts" });
    expect((init.headers as Record<string, string>)["X-Webhook-Secret"]).toBe("s");
    expect(db.tables.research_brief_links.some(l => l.brief_id === "new-copy" && l.business_id === B)).toBe(true);
    vi.unstubAllGlobals();
  });

  it("maps Avery failures to 502 and missing config to 503", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "secret stuff" }), { status: 500 })));
    await expect(runOrgResearch(B, "x")).rejects.toMatchObject({ status: 502, message: "Research failed. Try again." });
    vi.unstubAllGlobals();
    delete process.env.AVERY_WEBHOOK_SECRET;
    await expect(runOrgResearch(B, "x")).rejects.toMatchObject({ status: 503 });
  });
});
