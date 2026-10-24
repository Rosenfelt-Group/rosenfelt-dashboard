import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const U1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MSG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const C2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const U2 = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const L1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const s = vi.hoisted(() => ({
  perms: [] as string[],
  guard: { ok: true } as { ok: boolean; response?: Response },
  tables: {} as Record<string, unknown>,
  calls: [] as { table: string; op: string; args: unknown[] }[],
  rpcs: [] as { fn: string; args: Record<string, any> }[],
  rpcError: null as { message: string } | null,
  updateRows: [{ id: "x" }] as unknown[],
  intake: vi.fn(),
  loadContacts: vi.fn(),
}));

vi.mock("@/lib/requirePermission", () => ({ requirePermission: async (_r: unknown, p: string) => { s.perms.push(p); return s.guard; } }));
vi.mock("@/lib/intake/client", () => ({ intakeLead: (...a: unknown[]) => s.intake(...a) }));
vi.mock("@/lib/email/ingest", async (orig) => ({ ...(await orig<typeof import("@/lib/email/ingest")>()), loadContactsByEmail: (...a: unknown[]) => s.loadContacts(...a) }));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => { s.rpcs.push({ fn, args }); return { data: { ok: true }, error: s.rpcError }; },
      from: (table: string) => {
        const b: Record<string, unknown> = {};
        for (const op of ["select", "eq", "is", "in", "ilike", "or", "order", "limit"]) b[op] = (...args: unknown[]) => { s.calls.push({ table, op, args }); return b; };
        let patch: Record<string, unknown> | null = null;
        let ids: string[] = [];
        b.update = (...args: unknown[]) => { s.calls.push({ table, op: "update", args }); patch = args[0] as Record<string, unknown>; return b; };
        const origEq = b.eq as (...a: unknown[]) => unknown, origIn = b.in as (...a: unknown[]) => unknown;
        b.eq = (...args: unknown[]) => { if (args[0] === "id") ids = [args[1] as string]; return origEq(...args); };
        b.in = (...args: unknown[]) => { if (args[0] === "id") ids = args[1] as string[]; return origIn(...args); };
        const data = () => s.tables[table];
        b.maybeSingle = async () => ({ data: Array.isArray(data()) ? (data() as unknown[])[0] ?? null : data() ?? null, error: null });
        b.single = b.maybeSingle;
        b.then = (res: (v: unknown) => void) => {
          if (patch) {
            // apply the update to the fake rows so a second fetch sees it
            if (Array.isArray(data())) for (const r of data() as Record<string, unknown>[]) if (ids.includes(r.id as string)) Object.assign(r, patch);
            return res({ data: s.updateRows, error: null });
          }
          return res({ data: Array.isArray(data()) ? data() : [], error: null });
        };
        return b;
      },
    }),
  },
}));

import { GET, POST } from "./route";

const post = (body: unknown) => POST(new NextRequest("http://x/api/crm/inbox", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
const message = { id: MSG, gmail_message_id: "g1", thread_id: "t1", rfc_message_id: "<r>", direction: "received", from_email: "new@acme.org", from_name: "New Person", to_emails: ["crm@rosably.com"], cc_emails: [], subject: "Hello", snippet: "snip", body_text: "body", sent_at: "2026-01-01T00:00:00Z", source: "forward", delivered_to_crm: true };

beforeEach(() => {
  s.perms = []; s.guard = { ok: true }; s.tables = {}; s.calls = []; s.rpcs = []; s.rpcError = null; s.updateRows = [{ id: "x" }];
  s.intake.mockReset(); s.loadContacts.mockReset();
});

describe("GET /api/crm/inbox", () => {
  it("requires view_crm", async () => {
    s.guard = { ok: false, response: new Response("no", { status: 403 }) };
    expect((await GET(new NextRequest("http://x/api/crm/inbox"))).status).toBe(403);
    expect(s.perms).toEqual(["view_crm"]);
  });

  it("computes and persists suggestions for unresolved rows without one", async () => {
    s.tables.unmatched_email_log = [{ id: U1, email_message_id: MSG, contact_email: "new@acme.org", direction: "received", subject: "Hello", snippet: "snip", timestamp: "2026-01-01T00:00:00Z", suggested_contact_id: null, suggestion_checked_at: null, message: { from_email: "new@acme.org", from_name: "New Person", subject: "Hello", snippet: "snip", sent_at: "2026-01-01T00:00:00Z" } }];
    s.tables.contacts = [{ id: C1, first_name: "Pat", last_name: "Lee", email_norm: "pat@acme.org" }];
    const body = await (await GET(new NextRequest("http://x/api/crm/inbox"))).json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: U1, suggested_contact: { id: C1, name: "Pat Lee" } });
    const upd = s.calls.findIndex((c) => c.table === "unmatched_email_log" && c.op === "update");
    expect(upd).toBeGreaterThan(-1);
    expect(s.calls[upd].args[0]).toMatchObject({ suggested_contact_id: C1 });
    expect((s.calls[upd].args[0] as Record<string, unknown>).suggestion_checked_at).toEqual(expect.any(String));
    expect(s.calls.filter((c) => c.table === "unmatched_email_log" && c.op === "is").map((c) => c.args)).toContainEqual(["suggestion_checked_at", null]);
  });

  it("suggestions_not_recomputed_on_second_fetch (also when nothing was found)", async () => {
    s.tables.unmatched_email_log = [
      { id: U1, email_message_id: MSG, contact_email: "new@acme.org", direction: "received", subject: "a", snippet: "s", timestamp: "2026-01-01T00:00:00Z", suggested_contact_id: null, suggestion_checked_at: null, message: null },
      { id: U2, email_message_id: MSG, contact_email: "who@nowhere.test", direction: "received", subject: "b", snippet: "s", timestamp: "2026-01-01T00:00:00Z", suggested_contact_id: null, suggestion_checked_at: null, message: null },
    ];
    s.tables.contacts = [{ id: C1, first_name: "Pat", last_name: "Lee", email_norm: "pat@acme.org" }];
    const contactQueries = () => s.calls.filter((c) => c.table === "contacts" && c.op === "select").length;
    const first = await (await GET(new NextRequest("http://x/api/crm/inbox"))).json();
    expect(first.items[0].suggested_contact.id).toBe(C1);
    expect(first.items[1].suggested_contact).toBeNull();
    // lookups are batched: one contacts query (one rule applies), not one per row
    const afterFirst = contactQueries();
    expect(afterFirst).toBeLessThanOrEqual(2);
    // the unmatched row is marked checked in one batched .in() update
    expect(s.calls.some((c) => c.table === "unmatched_email_log" && c.op === "in" && c.args[0] === "id")).toBe(true);
    const updatesAfterFirst = s.calls.filter((c) => c.op === "update").length;
    const second = await (await GET(new NextRequest("http://x/api/crm/inbox"))).json();
    expect(second.items[0].suggested_contact.id).toBe(C1); // persisted suggestion still shown
    expect(s.calls.filter((c) => c.table === "contacts" && c.op === "or")).toHaveLength(1); // no new domain/name lookup
    expect(s.calls.filter((c) => c.op === "update")).toHaveLength(updatesAfterFirst);
  });
});

describe("POST /api/crm/inbox", () => {
  it("requires manage_crm", async () => {
    s.guard = { ok: false, response: new Response("no", { status: 403 }) };
    expect((await post({ unmatched_id: U1, contact_id: C1 })).status).toBe(403);
    expect(s.perms).toEqual(["manage_crm"]);
  });

  it("rejects a body with neither or both of contact_id and create", async () => {
    expect((await post({ unmatched_id: U1 })).status).toBe(400);
    expect((await post({ unmatched_id: U1, contact_id: C1, create: { email: "a@b.co" } })).status).toBe(400);
  });

  it("resolve_links_and_backfills", async () => {
    s.tables.unmatched_email_log = { id: U1, email_message_id: MSG, contact_email: "new@acme.org", resolved_at: null };
    s.tables.email_messages = message;
    s.tables.contacts = { id: C1, email_norm: "pat@acme.org" };
    s.loadContacts.mockResolvedValue(new Map([["pat@acme.org", { contact_id: C1, lead_id: L1, client_id: null }]]));
    const res = await post({ unmatched_id: U1, contact_id: C1 });
    expect(res.status).toBe(200);
    expect(s.rpcs).toHaveLength(1);
    const p = s.rpcs[0].args.p;
    expect(s.rpcs[0].fn).toBe("store_ingested_email");
    expect(p.message).toMatchObject({ gmail_message_id: "g1", direction: "received", from_email: "new@acme.org", body_text: "body", source: "forward" });
    expect(p.links).toEqual([{ contact_id: C1, lead_id: L1, client_id: null }]);
    expect(p.activity).toMatchObject({ activity_type: "email_received", email_direction: "received", email_subject: "Hello", content: "snip" });
    expect(p.unmatched).toBeUndefined();
    const upd = s.calls.find((c) => c.table === "unmatched_email_log" && c.op === "update");
    expect(upd?.args[0]).toMatchObject({ resolved_contact_id: C1 });
    expect(typeof (upd?.args[0] as { resolved_at: string }).resolved_at).toBe("string");
    expect(s.intake).not.toHaveBeenCalled();
  });

  it("resolve_create_calls_intake", async () => {
    s.tables.unmatched_email_log = { id: U1, email_message_id: MSG, contact_email: "new@acme.org", resolved_at: null };
    s.tables.email_messages = { ...message, direction: "sent" };
    s.intake.mockResolvedValue({ contact_id: C2, business_id: "b", lead_id: L1, created_contact: true, created_lead: true });
    s.loadContacts.mockResolvedValue(new Map());
    const res = await post({ unmatched_id: U1, create: { email: "new@acme.org", name: "New Person", org: "Acme" } });
    expect(res.status).toBe(200);
    expect(s.intake).toHaveBeenCalledWith({ channel: "email_inbound", email: "new@acme.org", name: "New Person", org: "Acme" });
    const p = s.rpcs[0].args.p;
    expect(p.links).toEqual([{ contact_id: C2, lead_id: L1, client_id: null }]);
    expect(p.activity.activity_type).toBe("email_sent");
    expect((await res.json())).toMatchObject({ contact_id: C2 });
  });

  it("does not mark resolved when the store fails", async () => {
    s.tables.unmatched_email_log = { id: U1, email_message_id: MSG, contact_email: "x@y.co", resolved_at: null };
    s.tables.email_messages = message;
    s.tables.contacts = { id: C1, email_norm: "pat@acme.org" };
    s.loadContacts.mockResolvedValue(new Map());
    s.rpcError = { message: "boom" };
    expect((await post({ unmatched_id: U1, contact_id: C1 })).status).toBe(500);
    expect(s.calls.some((c) => c.table === "unmatched_email_log" && c.op === "update")).toBe(false);
  });

  it("concurrent_resolve_second_gets_409", async () => {
    s.tables.unmatched_email_log = { id: U1, email_message_id: MSG, contact_email: "x@y.co", resolved_at: null };
    s.tables.email_messages = message;
    s.tables.contacts = { id: C1, email_norm: "pat@acme.org" };
    s.loadContacts.mockResolvedValue(new Map());
    s.updateRows = []; // someone else resolved it between our read and our conditional update
    const res = await post({ unmatched_id: U1, contact_id: C1 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already resolved/i);
  });

  it("409 when the chosen contact is in Trash, and nothing is stored", async () => {
    s.tables.unmatched_email_log = { id: U1, email_message_id: MSG, contact_email: "new@acme.org", resolved_at: null };
    s.tables.email_messages = message;
    s.tables.contacts = { id: C1, email_norm: "pat@acme.org", deleted_at: "2026-10-25T00:00:00Z" };
    expect((await post({ unmatched_id: U1, contact_id: C1 })).status).toBe(409);
    expect(s.rpcs).toEqual([]);
  });

  it("409 when already resolved, 404 when missing", async () => {
    s.tables.unmatched_email_log = { id: U1, email_message_id: MSG, contact_email: "x@y.co", resolved_at: "2026-01-01T00:00:00Z" };
    expect((await post({ unmatched_id: U1, contact_id: C1 })).status).toBe(409);
    s.tables.unmatched_email_log = null;
    expect((await post({ unmatched_id: U1, contact_id: C1 })).status).toBe(404);
  });
});
