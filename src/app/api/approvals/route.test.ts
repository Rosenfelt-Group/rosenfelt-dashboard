import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  session: null as { username: string; role: string; permissions: string[] } | null,
  row: null as Record<string, unknown> | null,
  updated: [{ id: "a1" }] as unknown[],
  updates: [] as { payload: unknown; filters: [string, unknown][] }[],
}));

vi.mock("@/lib/session", () => ({
  COOKIE_NAME: "dashboard_session",
  verifySessionToken: vi.fn(async () => s.session),
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: s.row, error: null }) }) }),
      insert: async () => ({ error: null }),
      update: (payload: unknown) => {
        const rec = { payload, filters: [] as [string, unknown][] };
        s.updates.push(rec);
        const chain = {
          eq: (col: string, val: unknown) => {
            rec.filters.push([col, val]);
            return chain;
          },
          select: () => chain,
          then: (resolve: (v: unknown) => void) => resolve({ data: s.updated, error: null }),
        };
        return chain;
      },
    }),
  },
}));

import { PATCH } from "./route";

const patch = (headers: Record<string, string> = {}, status = "approved") =>
  PATCH(
    new NextRequest("http://x/api/approvals", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: "dashboard_session=tok", ...headers },
      body: JSON.stringify({ id: "a1", status }),
    }),
  );

const brian = { username: "brian", role: "admin", permissions: [] };

beforeEach(() => {
  s.session = brian;
  s.row = { id: "a1", agent: "pickle", action_type: "x", title: "t", payload: {}, status: "pending" };
  s.updated = [{ id: "a1" }];
  s.updates = [];
});

describe("PATCH /api/approvals - pickle rows", () => {
  it("403s a forged x-user-name with no valid session, and does not update", async () => {
    s.session = null;
    const res = await patch({ "x-user-name": "brian" });
    expect(res.status).toBe(403);
    expect(s.updates).toHaveLength(0);
  });

  it("403s a viewer session (casey_regression)", async () => {
    s.session = { username: "casey_regression", role: "viewer", permissions: [] };
    const res = await patch({ "x-user-name": "brian" });
    expect(res.status).toBe(403);
    expect(s.updates).toHaveLength(0);
  });

  it("lets brian approve, updating only while pending, reviewer from session", async () => {
    const res = await patch({ "x-user-name": "forged" });
    expect(res.status).toBe(200);
    expect(s.updates).toHaveLength(1);
    expect(s.updates[0].filters).toContainEqual(["status", "pending"]);
    expect(s.updates[0].payload).toMatchObject({ status: "approved", reviewed_by: "brian" });
  });

  it("403s a non-brian admin", async () => {
    s.session = { username: "someone", role: "admin", permissions: [] };
    expect((await patch()).status).toBe(403);
    expect(s.updates).toHaveLength(0);
  });

  it("403s brian with a non-admin role", async () => {
    s.session = { username: "brian", role: "viewer", permissions: [] };
    expect((await patch()).status).toBe(403);
    expect(s.updates).toHaveLength(0);
  });

  it("409s when the row is no longer pending (fetched)", async () => {
    s.row = { ...s.row, status: "approved" };
    expect((await patch()).status).toBe(409);
    expect(s.updates).toHaveLength(0);
  });

  it("409s when the guarded update touches zero rows", async () => {
    s.updated = [];
    expect((await patch()).status).toBe(409);
    expect(s.updates).toHaveLength(1);
  });

  it("applies the same gate to rejecting a pickle row", async () => {
    s.session = { username: "casey_regression", role: "viewer", permissions: [] };
    expect((await patch({}, "rejected")).status).toBe(403);
  });
});

describe("PATCH /api/approvals - non-pickle rows", () => {
  beforeEach(() => {
    s.row = { id: "a1", agent: "jordan", action_type: "x", title: "t", payload: {}, status: "pending" };
  });

  it("ignores a forged header: reviewed_by comes from the session, no status filter", async () => {
    s.session = { username: "casey_regression", role: "viewer", permissions: [] };
    const res = await patch({ "x-user-name": "brian" });
    expect(res.status).toBe(200);
    expect(s.updates[0].payload).toMatchObject({ reviewed_by: "casey_regression" });
    expect(s.updates[0].filters).not.toContainEqual(["status", "pending"]);
  });

  it("records null reviewer when there is no session, ignoring the header", async () => {
    s.session = null;
    await patch({ "x-user-name": "brian" });
    expect(s.updates[0].payload).toMatchObject({ reviewed_by: null });
  });
});
