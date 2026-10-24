import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const ENG = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";

// Per-test knobs for the stubbed tables.
const state = vi.hoisted(() => ({
  engagement: { id: "e", status: "active", business_id: "b", title: "T", relationship: "client", client_id: null, discovery_invite_id: null } as Record<string, unknown> | null,
  insertResult: { data: { id: "x" }, error: null } as { data: { id: string } | null; error: { message: string } | null },
  deliverableKind: "prototype",
  workItemInserts: 0,
  openBuilds: [] as Array<{ work_item_id: string; ref: number | null; stalled: boolean }> | null,
  scope: null as unknown,                 // value returned by findScopeForEngagement, or an Error to throw
  description: "" as string,              // the work item description the route stored
}));

// Chainable stub: every filter returns the same builder; single/maybeSingle/insert resolve per table.
function table(name: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) b[m] = () => b;
  b.single = async () => {
    if (name === "engagements") return { data: state.engagement, error: null };
    if (name === "businesses") return { data: { name: "Acme", industry: "retail" }, error: null };
    if (name === "deliverables") return { data: { id: "d", title: "Deliverable", kind: state.deliverableKind }, error: null };
    return { data: null, error: null };
  };
  b.maybeSingle = async () => ({ data: null, error: null });
  b.insert = (row: Record<string, unknown>) => {
    if (name === "work_items") { state.workItemInserts++; state.description = String(row.description ?? ""); }
    return {
      select: () => ({
        single: async () =>
          name === "work_items" ? state.insertResult : { data: { id: "33333333-3333-4333-8333-333333333333" }, error: null },
      }),
    };
  };
  return b;
}

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (n: string) => table(n),
    schema: () => ({ from: (n: string) => table(n) }),
  },
}));
vi.mock("@/lib/rooms/dispatch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rooms/dispatch")>()),
  dispatchBeginWork: vi.fn(),
}));

vi.mock("@/lib/rooms/open-builds", () => ({ findOpenBuilds: async () => state.openBuilds }));
vi.mock("@/lib/rooms/scope-for-brief", () => ({
  findScopeForEngagement: async () => { if (state.scope instanceof Error) throw state.scope; return state.scope; },
}));

import { POST } from "./route";
import { dispatchBeginWork } from "@/lib/rooms/dispatch";

// Routes check permissions themselves; these tests exercise the handler logic as an admin.
vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));
vi.mock("@/lib/requireAdmin", () => ({ requireAdmin: async () => ({ ok: true, username: "brian" }) }));

const mockDispatch = vi.mocked(dispatchBeginWork);
const call = () =>
  POST(
    new NextRequest(`https://evil.example/api/engagements/${ENG}/prototype-request`, {
      method: "POST",
      headers: { cookie: "session=abc", host: "evil.example", "content-type": "application/json" },
      body: JSON.stringify({ agent: "casey", brief: "Build it", deliverable_title: "Landing" }),
    }),
    { params: Promise.resolve({ id: ENG }) },
  );

beforeEach(() => {
  mockDispatch.mockReset();
  state.engagement = { id: ENG, status: "active", business_id: "b", title: "T", relationship: "client", client_id: null, discovery_invite_id: null };
  state.insertResult = { data: { id: ITEM }, error: null };
  state.deliverableKind = "prototype";
  state.workItemInserts = 0;
  state.openBuilds = [];
  state.scope = null;
  state.description = "";
  process.env.DASHBOARD_BASE_URL = "https://dash.example.com";
});

describe("POST prototype-request", () => {
  it("still returns 201 with dispatched:false when the dispatch fails", async () => {
    mockDispatch.mockResolvedValue({ dispatched: false, error: "HTTP 500" });
    const res = await call();
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.dispatched).toBe(false);
    expect(body.dispatch_error).toBe("HTTP 500");
    expect(body.work_item_id).toBe(ITEM);
  });

  it("dispatches to the configured base URL (not the request host) with the item id and cookie", async () => {
    mockDispatch.mockResolvedValue({ dispatched: true });
    const res = await call();
    expect(res.status).toBe(201);
    expect((await res.json()).dispatched).toBe(true);
    expect(mockDispatch).toHaveBeenCalledWith("https://dash.example.com", ITEM, "session=abc");
  });

  it("returns 500 and does not dispatch when the work item insert fails", async () => {
    state.insertResult = { data: null, error: { message: "boom" } };
    const res = await call();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Could not create the work item.");
    expect(JSON.stringify(body)).not.toContain("boom");
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("returns 409 and does not dispatch for a closed engagement", async () => {
    state.engagement = { ...state.engagement, status: "closed" };
    const res = await call();
    expect(res.status).toBe(409);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  const callExisting = () =>
    POST(
      new NextRequest(`https://evil.example/api/engagements/${ENG}/prototype-request`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: "casey", brief: "Make it", deliverable_id: "55555555-5555-4555-8555-555555555555" }),
      }),
      { params: Promise.resolve({ id: ENG }) },
    );

  it("returns 409 and creates no work item while a build for the deliverable is running", async () => {
    state.openBuilds = [{ work_item_id: ITEM, ref: 1374, stalled: false }];
    const res = await callExisting();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("#1374");
    expect(body.work_item_id).toBe(ITEM);
    expect(state.workItemInserts).toBe(0);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("allows a new request when the open build has stalled", async () => {
    state.openBuilds = [{ work_item_id: ITEM, ref: 1369, stalled: true }];
    mockDispatch.mockResolvedValue({ dispatched: true });
    const res = await callExisting();
    expect(res.status).toBe(201);
    expect(state.workItemInserts).toBe(1);
  });

  it("returns 500 and creates no work item when the running-build check fails", async () => {
    state.openBuilds = null;
    const res = await callExisting();
    expect(res.status).toBe(500);
    expect(state.workItemInserts).toBe(0);
  });

  it("returns 409 and creates no work item when the deliverable is a document", async () => {
    state.deliverableKind = "document";
    const res = await callExisting();
    expect(res.status).toBe(409);
    expect(state.workItemInserts).toBe(0);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("puts the engagement's scope document in the brief", async () => {
    mockDispatch.mockResolvedValue({ dispatched: true });
    state.scope = { title: "Scope", engagementType: "assessment", deliveryModel: "fixed", versionNo: 2,
                    sections: [{ key: "proposed_scope", title: "Proposed scope", body_md: "PROPOSED-BODY" }] };
    const res = await call();
    expect(res.status).toBe(201);
    expect(state.description).toContain('<quoted_data source="scope_document">');
    expect(state.description).toContain("PROPOSED-BODY");
  });

  it("still creates the request (without a scope block) when the scope lookup fails", async () => {
    mockDispatch.mockResolvedValue({ dispatched: true });
    state.scope = new Error("db down");
    const res = await call();
    expect(res.status).toBe(201);
    expect(state.workItemInserts).toBe(1);
    expect(state.description).not.toContain("scope_document");
  });
});
