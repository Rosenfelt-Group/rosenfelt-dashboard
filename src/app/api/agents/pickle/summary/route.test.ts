import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const q = vi.hoisted(() => ({ calls: [] as { table: string; filters: [string, unknown][] }[] }));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const call = { table, filters: [] as [string, unknown][] };
      q.calls.push(call);
      const chain: Record<string, unknown> = {};
      const rec = (op: string) => (col: string, v: unknown) => { call.filters.push([`${op}:${col}`, v]); return chain; };
      Object.assign(chain, {
        select: (_c: string, opts?: { head?: boolean }) => { if (opts?.head) call.filters.push(["head", true]); return chain; },
        eq: rec("eq"), in: rec("in"), order: () => chain,
        limit: async () => ({ data: [{ id: "w1", ref: 1390, title: "Fix the indexer" }], error: null }),
        then: (res: (v: unknown) => void) => res({ count: table === "pending_approvals" ? 1 : 3, error: null }),
      });
      return chain;
    },
  },
}));
import { GET } from "./route";

beforeEach(() => { q.calls.length = 0; });

describe("GET /api/agents/pickle/summary", () => {
  it("reports the job in progress, the queue Pickle polls, and its pending approvals", async () => {
    const body = await (await GET()).json();
    expect(body).toEqual({ working: [{ id: "w1", ref: 1390, title: "Fix the indexer" }], queue: 3, approvals_pending: 1 });
    const queue = q.calls.find(c => c.filters.some(([k, v]) => k === "in:status"))!;
    expect(queue.filters).toContainEqual(["in:status", ["inbox", "open", "approved"]]);
    expect(queue.filters).toContainEqual(["eq:assigned_agent", "pickle"]);
    const appr = q.calls.find(c => c.table === "pending_approvals")!;
    expect(appr.filters).toEqual(expect.arrayContaining([["eq:agent", "pickle"], ["eq:status", "pending"]]));
  });
});
