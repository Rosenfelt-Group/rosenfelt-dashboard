import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({ calls: [] as { op: string; args: unknown[] }[] }));

vi.mock("@/lib/requirePermission", () => ({ requirePermission: async () => ({ ok: true, username: "brian", role: "admin" }) }));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      from: () => {
        const b: Record<string, unknown> = {};
        for (const op of ["select", "is", "or", "order", "limit"]) b[op] = (...args: unknown[]) => { s.calls.push({ op, args }); return b; };
        b.then = (res: (v: unknown) => void) => res({ data: [{ id: "c1" }], error: null });
        return b;
      },
    }),
  },
}));

import { GET } from "./route";

const get = (qs = "") => GET(new NextRequest(`http://x/api/crm/contacts${qs}`));
const ops = (op: string) => s.calls.filter(c => c.op === op).map(c => c.args);

beforeEach(() => { s.calls = []; });

describe("GET /api/crm/contacts", () => {
  it("lists every live contact when there is no query", async () => {
    expect(await (await get()).json()).toEqual([{ id: "c1" }]);
    expect(ops("is")).toEqual([["deleted_at", null]]);
    expect(ops("or")).toEqual([]);
    expect(ops("limit")).toEqual([]);
  });

  it("?q= searches names and email, limited to 20 by default", async () => {
    await get("?q=dana");
    expect(ops("or")).toEqual([["first_name.ilike.*dana*,last_name.ilike.*dana*,email.ilike.*dana*"]]);
    expect(ops("limit")).toEqual([[20]]);
    expect(ops("is")).toEqual([["deleted_at", null]]);
  });

  it("?limit= is clamped to 50, and a too-short query is ignored", async () => {
    await get("?q=dana&limit=500");
    expect(ops("limit")).toEqual([[50]]);
    s.calls = [];
    await get("?q=d");
    expect(ops("or")).toEqual([]);
  });
});
