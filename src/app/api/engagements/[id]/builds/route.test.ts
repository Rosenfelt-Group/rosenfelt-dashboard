import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  deliverables: { data: [] as unknown[], error: null as unknown },
  items: { data: [] as unknown[], error: null as unknown },
  logs: { data: [] as unknown[], error: null as unknown },
  versions: { data: [] as unknown[], error: null as unknown },
  itemFilters: [] as unknown[][],
}));
vi.mock("@/lib/supabase-admin", () => {
  const chain = (get: () => unknown, record?: unknown[][]) => {
    const b: Record<string, unknown> = {};
    for (const k of ["select", "eq", "like", "not", "in", "order", "limit"]) {
      b[k] = (...a: unknown[]) => { record?.push([k, ...a]); return b; };
    }
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(get()).then(res);
    return b;
  };
  return {
    supabaseAdmin: {
      schema: () => ({ from: (t: string) => chain(() => (t === "deliverable_versions" ? s.versions : s.deliverables)) }),
      from: (t: string) => (t === "work_items" ? chain(() => s.items, s.itemFilters) : chain(() => s.logs)),
    },
  };
});
import { GET } from "./route";

// Routes check permissions themselves; these tests exercise the handler logic as an admin.
vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));
vi.mock("@/lib/requireAdmin", () => ({ requireAdmin: async () => ({ ok: true, username: "brian" }) }));

const ENG = "11111111-1111-4111-8111-111111111111";
const D1 = "ba906f5a-a10d-4df3-8e51-7fc9016d6aca";
const D2 = "22222222-2222-4222-8222-222222222222";
const W1 = "563fc43f-f6d6-478a-8478-158f5b09d313";
const call = (id = ENG) => GET(new NextRequest(`https://d.test/api/engagements/${id}/builds`), { params: Promise.resolve({ id }) });
const item = (id: string, did: string, over: Record<string, unknown> = {}) => ({
  id, ref: 1297, title: "Prototype", status: "in_progress", assigned_agent: "casey",
  description: `ROOMS_PROTOTYPE_REQUEST v1\ndeliverable_id: ${did}\nBuild it`, created_at: new Date(Date.now() - 120_000).toISOString(),
  updated_at: new Date(Date.now() - 60_000).toISOString(), ...over,
});
const log = (wid: string, minsAgo: number, message: string) => ({
  work_item_id: wid, created_at: new Date(Date.now() - minsAgo * 60_000).toISOString(), author: "casey", entry_type: "progress", message,
});

beforeEach(() => {
  s.deliverables = { data: [{ id: D1 }], error: null };
  s.items = { data: [item(W1, D1)], error: null };
  s.logs = { data: [log(W1, 1, "Prototype iteration started.")], error: null };
  s.versions = { data: [], error: null };
  s.itemFilters = [];
});

describe("GET engagements/[id]/builds", () => {
  it("returns the open request for a prototype deliverable with its latest log and not stalled", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    const { builds, now } = await r.json();
    expect(typeof now).toBe("string");
    expect(builds).toHaveLength(1);
    expect(builds[0]).toMatchObject({ deliverable_id: D1, work_item_id: W1, ref: 1297, status: "in_progress", agent: "casey", stalled: false });
    expect(builds[0].logs[0]).toMatchObject({ author: "casey", type: "progress", message: "Prototype iteration started." });
  });
  it("asks the database only for open prototype requests (closed statuses excluded)", async () => {
    await call();
    const flat = JSON.stringify(s.itemFilters);
    expect(flat).toContain("ROOMS_PROTOTYPE_REQUEST v1");
    for (const st of ["done", "cancelled", "rejected", "deferred"]) expect(flat).toContain(st);
  });
  it("ignores requests for other engagements' deliverables and non-request work items", async () => {
    s.items = { data: [item(W1, D2), item("w3", D1, { description: "Fix the login bug" })], error: null };
    const { builds } = await (await call()).json();
    expect(builds).toEqual([]);
  });
  it("flags a request with no activity for over 10 minutes as stalled, using the latest log time", async () => {
    s.items = { data: [item(W1, D1, { created_at: new Date(Date.now() - 30 * 60_000).toISOString(), updated_at: new Date(Date.now() - 25 * 60_000).toISOString() })], error: null };
    s.logs = { data: [log(W1, 20, "Working on screens")], error: null };
    const { builds } = await (await call()).json();
    expect(builds[0].stalled).toBe(true);
  });
  it("falls back to the work item's own timestamps when it has no logs, and keeps only the latest 5 logs newest first", async () => {
    s.logs = { data: [], error: null };
    expect((await (await call()).json()).builds[0].logs).toEqual([]);
    s.logs = { data: Array.from({ length: 8 }, (_, i) => log(W1, 8 - i, `m${i}`)), error: null };
    const { builds } = await (await call()).json();
    expect(builds[0].logs).toHaveLength(5);
    expect(builds[0].logs[0].message).toBe("m7");
  });
  it("truncates a long log message", async () => {
    s.logs = { data: [log(W1, 1, "x".repeat(2000))], error: null };
    const { builds } = await (await call()).json();
    expect(builds[0].logs[0].message.length).toBeLessThanOrEqual(300);
  });
  it("returns an empty list when there are no prototype deliverables, 400 for a bad id, and a fixed 500 on database errors", async () => {
    s.deliverables = { data: [], error: null };
    expect((await (await call()).json()).builds).toEqual([]);
    expect((await call("nope")).status).toBe(400);
    s.deliverables = { data: [{ id: D1 }], error: null };
    s.items = { data: [], error: { message: "secret_table" } };
    const r = await call();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secret_table");
  });
  it("drops a build whose work item already produced a version, keeping the others", async () => {
    const W2 = "33333333-3333-4333-8333-333333333333";
    s.items = { data: [item(W1, D1), item(W2, D1)], error: null };
    s.versions = { data: [{ work_item_id: W1 }], error: null };
    const { builds } = await (await call()).json();
    expect(builds.map((b: { work_item_id: string }) => b.work_item_id)).toEqual([W2]);
  });
  it("returns an empty list when every open request already has a version", async () => {
    s.versions = { data: [{ work_item_id: W1 }], error: null };
    expect((await (await call()).json()).builds).toEqual([]);
  });
  it("gives the fixed 500 when the versions lookup fails", async () => {
    s.versions = { data: [], error: { message: "secret_versions" } };
    const r = await call();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secret_versions");
  });
});
