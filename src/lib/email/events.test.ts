import { describe, it, expect, vi, beforeEach } from "vitest";

const s = vi.hoisted(() => ({
  calls: [] as [string, ...unknown[]][],
  result: { data: [] as unknown[], count: 0, error: null as { message: string } | null },
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      from: (table: string) => {
        s.calls.push(["from", table]);
        const b: Record<string, unknown> = {};
        for (const m of ["select", "neq", "gte", "is", "eq", "ilike", "filter", "order", "limit", "update", "insert", "maybeSingle"]) {
          b[m] = (...a: unknown[]) => { s.calls.push([m, ...a]); return b; };
        }
        b.then = (res: (v: unknown) => unknown) => Promise.resolve(s.result).then(res);
        return b;
      },
    }),
  },
}));

import { listProblems, resolveEvents, logAction, windowCounts, getEvent } from "./events";

const has = (...c: unknown[]) => s.calls.some((x) => JSON.stringify(x) === JSON.stringify(c));

beforeEach(() => {
  s.calls = [];
  s.result = { data: [], count: 0, error: null };
});

describe("listProblems", () => {
  it("excludes deliveries, hides resolved by default, newest first, limit 200", async () => {
    await listProblems({ since: "2026-10-10T00:00:00Z" });
    expect(has("neq", "record_type", "Delivery")).toBe(true);
    expect(has("is", "resolved_at", null)).toBe(true);
    expect(has("order", "occurred_at", { ascending: false })).toBe(true);
    expect(has("limit", 200)).toBe(true);
  });
  it("includes resolved when asked", async () => {
    await listProblems({ since: "x", includeResolved: true });
    expect(has("is", "resolved_at", null)).toBe(false);
  });
  it("throws on a store error", async () => {
    s.result.error = { message: "boom" };
    await expect(listProblems({ since: "x" })).rejects.toThrow(/boom/);
  });
});

describe("windowCounts", () => {
  it("counts hard bounces as unresolved inactive Bounce rows", async () => {
    s.result.count = 3;
    await expect(windowCounts("x")).resolves.toEqual({ delivered: 3, unresolvedHardBounces: 3, unresolvedSpam: 3, events: 3 });
    expect(has("eq", "inactive", true)).toBe(true);
    expect(has("eq", "record_type", "SpamComplaint")).toBe(true);
  });
});

describe("resolveEvents", () => {
  it("only touches unresolved rows, matches recipient exactly and case-insensitively", async () => {
    s.result.data = [{ id: "1" }, { id: "2" }];
    await expect(resolveEvents({ recipient: "a_b%@x.co" }, "dismissed", "brian")).resolves.toBe(2);
    expect(has("is", "resolved_at", null)).toBe(true);
    expect(has("filter", "recipient", "imatch", "^a_b%@x\\.co$")).toBe(true);
    expect(s.calls.some((c) => c[0] === "ilike")).toBe(false);
  });
  it("does not turn * (or other pattern characters) in a recipient into a wildcard", async () => {
    s.result.data = [{ id: "1" }];
    await resolveEvents({ recipient: "*@x.co" }, "dismissed", "brian");
    expect(has("filter", "recipient", "imatch", "^\\*@x\\.co$")).toBe(true);
    expect(s.calls.some((c) => c[0] === "ilike")).toBe(false);
  });
  it("does nothing without a filter", async () => {
    await expect(resolveEvents({}, "dismissed", "b")).resolves.toBe(0);
    expect(s.calls).toEqual([]);
  });
});

describe("logAction", () => {
  it("never throws on failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    s.result.error = { message: "nope" };
    await expect(logAction({ action: "dismiss", by: "b" })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("getEvent", () => {
  it("loads one event by id, or null", async () => {
    s.result = { data: { id: "e1" } as unknown as unknown[], count: 0, error: null };
    expect(await getEvent("e1")).toEqual({ id: "e1" });
    expect(has("eq", "id", "e1")).toBe(true);
    s.result = { data: null as unknown as unknown[], count: 0, error: null };
    expect(await getEvent("e2")).toBeNull();
  });
});
