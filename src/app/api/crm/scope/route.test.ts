import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  guard: { ok: true } as { ok: boolean; response?: Response },
  perm: "" as string,
  rows: [{ id: "d1", title: "Scope A" }] as unknown[],
  calls: [] as { op: string; args: unknown[] }[],
}));

vi.mock("@/lib/requirePermission", () => ({ requirePermission: async (_r: unknown, p: string) => { s.perm = p; return s.guard; } }));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      from: () => {
        const b: Record<string, unknown> = {};
        for (const op of ["select", "order"]) b[op] = (...args: unknown[]) => { s.calls.push({ op, args }); return b; };
        b.limit = async (...args: unknown[]) => { s.calls.push({ op: "limit", args }); return { data: s.rows, error: null }; };
        return b;
      },
    }),
  },
}));

import { GET } from "./route";

const req = (qs: string) => new NextRequest(`http://x/api/crm/scope${qs}`);

beforeEach(() => { s.guard = { ok: true }; s.rows = [{ id: "d1", title: "Scope A" }]; s.calls = []; s.perm = ""; });

describe("GET /api/crm/scope?list=1", () => {
  it("requires view_crm and returns 403 without it", async () => {
    s.guard = { ok: false, response: new Response("no", { status: 403 }) };
    const res = await GET(req("?list=1"));
    expect(s.perm).toBe("view_crm");
    expect(res.status).toBe(403);
    expect(s.calls).toEqual([]);
  });

  it("lists scope documents newest first, capped", async () => {
    const res = await GET(req("?list=1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ documents: [{ id: "d1", title: "Scope A" }] });
    expect(s.calls.find(c => c.op === "order")?.args[0]).toBe("created_at");
    expect(s.calls.find(c => c.op === "limit")?.args[0]).toBe(200);
  });

  it("still requires lead_id or client_id without list", async () => {
    expect((await GET(req(""))).status).toBe(400);
  });
});
