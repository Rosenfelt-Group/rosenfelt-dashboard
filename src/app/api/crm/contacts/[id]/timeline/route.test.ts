import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  guard: { ok: true } as { ok: boolean; response?: Response },
  perm: "" as string,
  rows: [] as unknown[],
  body: null as unknown,
  rpc: [] as { fn: string; args: Record<string, unknown> }[],
  calls: [] as { op: string; args: unknown[] }[],
}));

vi.mock("@/lib/requirePermission", () => ({ requirePermission: async (_r: unknown, p: string) => { s.perm = p; return s.guard; } }));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => { s.rpc.push({ fn, args }); return { data: s.rows, error: null }; },
      from: () => {
        const b: Record<string, unknown> = {};
        for (const op of ["select", "eq"]) b[op] = (...args: unknown[]) => { s.calls.push({ op, args }); return b; };
        b.maybeSingle = async () => ({ data: s.body, error: null });
        return b;
      },
    }),
  },
}));

import { GET } from "./route";

const CID = "11111111-1111-4111-8111-111111111111";
const M1 = "22222222-2222-4222-8222-222222222222";
const req = (qs = "") => new NextRequest(`http://x/api/crm/contacts/${CID}/timeline${qs}`);
const ctx = { params: Promise.resolve({ id: CID }) };
const row = (i: number) => ({ kind: "email", id: `id${i}`, ts: new Date(Date.UTC(2026, 0, 1, 0, 0, 100 - i)).toISOString(), activity_id: null, email_message_id: `id${i}`, payload: { direction: "received", preview: "p", body_truncated: false } });

beforeEach(() => { s.guard = { ok: true }; s.rows = []; s.body = null; s.rpc = []; s.calls = []; });

describe("GET /api/crm/contacts/:id/timeline", () => {
  it("requires view_crm", async () => {
    s.guard = { ok: false, response: new Response("no", { status: 403 }) };
    expect((await GET(req(), ctx)).status).toBe(403);
    expect(s.perm).toBe("view_crm");
  });

  it("timeline_merges_and_paginates: calls the rpc with the keyset cursor and returns next_cursor", async () => {
    s.rows = Array.from({ length: 50 }, (_, i) => row(i));
    const res = await GET(req(`?before_ts=2026-02-01T00:00:00.123456Z&before_id=${M1}`), ctx);
    const body = await res.json();
    expect(s.rpc).toEqual([{ fn: "contact_timeline", args: { p_contact_id: CID, p_before_ts: "2026-02-01T00:00:00.123456Z", p_before_id: M1, p_limit: 50 } }]);
    expect(body.items).toHaveLength(50);
    expect(body.next_cursor).toEqual({ before_ts: s.rows.at(-1) && (s.rows.at(-1) as { ts: string }).ts, before_id: "id49" });
  });

  it("short page has no next_cursor", async () => {
    s.rows = [row(0)];
    expect((await (await GET(req(), ctx)).json()).next_cursor).toBeNull();
  });

  it("never returns the full body in a page", async () => {
    s.rows = [row(0)];
    expect(JSON.stringify(await (await GET(req(), ctx)).json())).not.toContain("body_text");
  });

  it("include_body looks the message up by id with no cursor", async () => {
    s.body = { id: M1, body_text: "full text" };
    const body = await (await GET(req(`?include_body=${M1}`), ctx)).json();
    expect(body).toEqual({ body: { email_message_id: M1, body_text: "full text" } });
    expect(s.rpc).toHaveLength(0);
    expect(s.calls.filter((c) => c.op === "eq").map((c) => c.args)).toEqual([["id", M1], ["email_message_links.contact_id", CID]]);
  });

  it("include_body 404 when the message is not linked to the contact", async () => {
    expect((await GET(req(`?include_body=${M1}`), ctx)).status).toBe(404);
  });

  it("rejects bad input", async () => {
    expect((await GET(req("?before_ts=yesterday"), ctx)).status).toBe(400);
    expect((await GET(req("?before_ts=2026-01-01T00:00:00Z&before_id=x"), ctx)).status).toBe(400);
    expect((await GET(req(`?before_id=${M1}`), ctx)).status).toBe(400);
    expect((await GET(req("?include_body=x"), ctx)).status).toBe(400);
    expect((await GET(req(), { params: Promise.resolve({ id: "x),or(1" }) })).status).toBe(400);
  });
});
