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
  b.insert = () => {
    if (name === "work_items") state.workItemInserts++;
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

import { POST } from "./route";
import { dispatchBeginWork } from "@/lib/rooms/dispatch";

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
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("returns 409 and does not dispatch for a closed engagement", async () => {
    state.engagement = { ...state.engagement, status: "closed" };
    const res = await call();
    expect(res.status).toBe(409);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("returns 409 and creates no work item when the deliverable is a document", async () => {
    state.deliverableKind = "document";
    const res = await POST(
      new NextRequest(`https://evil.example/api/engagements/${ENG}/prototype-request`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: "casey", brief: "Make it", deliverable_id: "55555555-5555-4555-8555-555555555555" }),
      }),
      { params: Promise.resolve({ id: ENG }) },
    );
    expect(res.status).toBe(409);
    expect(state.workItemInserts).toBe(0);
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
