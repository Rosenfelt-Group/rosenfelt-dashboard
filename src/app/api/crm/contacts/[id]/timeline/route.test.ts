import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  guard: { ok: true } as { ok: boolean; response?: Response },
  perm: "" as string,
  tables: {} as Record<string, unknown[]>,
  calls: [] as { table: string; op: string; args: unknown[] }[],
}));

vi.mock("@/lib/requirePermission", () => ({
  requirePermission: async (_r: unknown, p: string) => { s.perm = p; return s.guard; },
}));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      from: (table: string) => {
        const b: Record<string, unknown> = {};
        for (const op of ["select", "eq", "or", "lt", "order", "limit", "in"]) b[op] = (...args: unknown[]) => { s.calls.push({ table, op, args }); return b; };
        b.then = (res: (v: unknown) => void) => res({ data: s.tables[table] ?? [], error: null });
        return b;
      },
    }),
  },
}));

import { GET } from "./route";

const CID = "11111111-1111-1111-1111-111111111111";
const L1 = "33333333-3333-3333-3333-333333333333";
const M1 = "22222222-2222-2222-2222-222222222222";
const req = (qs = "") => new NextRequest(`http://x/api/crm/contacts/${CID}/timeline${qs}`);
const ctx = { params: Promise.resolve({ id: CID }) };
const msg = (id: string, ts: string) => ({ id, gmail_message_id: "g", thread_id: "t", direction: "received", from_email: "a@b.co", from_name: null, to_emails: [], cc_emails: [], subject: "S", snippet: "sn", body_text: "body", sent_at: ts, created_at: ts, email_message_links: [{ contact_id: CID }] });

beforeEach(() => { s.guard = { ok: true }; s.tables = {}; s.calls = []; });

describe("GET /api/crm/contacts/:id/timeline", () => {
  it("requires view_crm", async () => {
    s.guard = { ok: false, response: new Response("no", { status: 403 }) };
    const res = await GET(req(), ctx);
    expect(res.status).toBe(403);
    expect(s.perm).toBe("view_crm");
  });

  it("timeline_merges_and_paginates", async () => {
    s.tables.leads = [{ id: L1 }];
    s.tables.lead_activities = [
      { id: "a1", created_at: "2026-01-02T00:00:00Z", activity_type: "note", content: "n", metadata: null },
      { id: "a2", created_at: "2026-01-03T00:05:00Z", activity_type: "email_received", metadata: { email_message_id: M1 } },
    ];
    s.tables.email_messages = [msg(M1, "2026-01-03T00:00:00Z"), ...Array.from({ length: 60 }, (_, i) => msg("m" + i, new Date(Date.UTC(2025, 5, 1, 0, 0, 60 - i)).toISOString()))];
    const res = await GET(req("?before=2026-02-01T00:00:00Z"), ctx);
    const body = await res.json();
    expect(body).toHaveLength(50);
    expect(body[0]).toMatchObject({ kind: "email", id: M1, activity_id: "a2" });
    expect(body[1]).toMatchObject({ kind: "activity", id: "a1" });
    expect(body.filter((i: { id: string }) => i.id === "a2")).toHaveLength(0);
    // Both sources are bounded by the cursor, the activity query covers the contact's leads, and each fetches one page.
    expect(s.calls.filter((c) => c.op === "lt").map((c) => c.args)).toEqual([["created_at", "2026-02-01T00:00:00.000Z"], ["sent_at", "2026-02-01T00:00:00.000Z"]]);
    expect(s.calls.find((c) => c.op === "or")?.args[0]).toBe(`contact_id.eq.${CID},lead_id.in.(${L1})`);
    expect(s.calls.filter((c) => c.op === "limit").map((c) => c.args[0])).toEqual([50, 50]);
  });

  it("returns a body preview only, and the full body for include_body", async () => {
    s.tables.email_messages = [{ ...msg(M1, "2026-01-03T00:00:00Z"), body_text: "z".repeat(800) }];
    const a = (await (await GET(req(), ctx)).json())[0];
    expect(a.preview).toHaveLength(500);
    expect(a.body_text).toBeUndefined();
    const b = (await (await GET(req(`?include_body=${M1}`), ctx)).json())[0];
    expect(b.body_text).toHaveLength(800);
  });

  it("rejects bad cursor and bad include_body", async () => {
    expect((await GET(req("?before=yesterday"), ctx)).status).toBe(400);
    expect((await GET(req("?include_body=x"), ctx)).status).toBe(400);
  });

  it("rejects a non-uuid contact id", async () => {
    expect((await GET(req(), { params: Promise.resolve({ id: "x),or(1" }) })).status).toBe(400);
  });
});
