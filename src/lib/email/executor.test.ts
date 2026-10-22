import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  messages: {} as Record<string, Record<string, unknown>>,
  sends: [] as { raw: string; opts?: { threadId?: string } }[],
  sendError: null as string | null,
  rpcCalls: [] as { fn: string; args: { p: Record<string, unknown> } }[],
  rpcError: null as string | null,
  contacts: new Map<string, { contact_id: string; lead_id: string | null; client_id: string | null }>(),
  lookups: [] as string[][],
  readId: null as string | null, // Message-ID the mocked Gmail read returns
  readError: null as string | null,
  readHang: false,
}));

vi.mock("@/lib/supabase-admin", () => {
  const apply = (filters: ((r: Row) => boolean)[], r: Row) => filters.every((f) => f(r));
  return {
    supabaseAdmin: {
      from: (table: string) => ({
        select: () => ({ eq: (_c: string, id: unknown) => ({ single: async () => ({ data: h.rows.find((r) => r.id === id) ?? null, error: null }) }) }),
        update: (patch: Row) => {
          const filters: ((r: Row) => boolean)[] = [];
          let lt: [string, string] | null = null;
          let orNull = false;
          const run = () => {
            expect(table).toBe("pending_approvals");
            const hit = h.rows.filter((r) => apply(filters, r) && (!lt || (orNull && r[lt[0]] == null) || String(r[lt[0]]) < lt[1]));
            hit.forEach((r) => Object.assign(r, patch));
            return { data: hit.map((r) => ({ ...r })), error: null };
          };
          const chain: Record<string, unknown> = {
            eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain),
            is: (c: string, _v: null) => (filters.push((r) => r[c] == null), chain),
            not: (c: string, _op: string, _v: null) => (filters.push((r) => r[c] != null), chain),
            lt: (c: string, v: string) => ((lt = [c, v]), chain),
            or: (expr: string) => { const m = /^(\w+)\.lt\.(.+),\w+\.is\.null$/.exec(expr); if (m) { lt = [m[1], m[2]]; orNull = true; } return chain; },
            select: () => chain,
            then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
          };
          return chain;
        },
      }),
      schema: () => ({
        rpc: async (fn: string, args: { p: Record<string, unknown> }) => {
          h.rpcCalls.push({ fn, args });
          return { data: {}, error: h.rpcError ? { message: h.rpcError } : null };
        },
        from: () => ({ select: () => ({ eq: (_c: string, id: string) => ({ single: async () => ({ data: h.messages[id] ?? null, error: h.messages[id] ? null : { message: "not found" } }) }) }) }),
      }),
    },
  };
});
vi.mock("./ingest", async (orig) => ({
  ...(await orig<typeof import("./ingest")>()),
  loadContactsByEmail: async (emails: string[]) => {
    h.lookups.push(emails);
    return new Map(emails.filter((e) => h.contacts.has(e.toLowerCase())).map((e) => [e.toLowerCase(), h.contacts.get(e.toLowerCase())!]));
  },
}));
vi.mock("./gmail-user", async () => {
  const actual = await vi.importActual<typeof import("./gmail-user")>("./gmail-user");
  return {
    ...actual,
    gmailRead: () => ({
      getRfcMessageId: async () => {
        if (h.readHang) return new Promise<string | null>(() => {});
        if (h.readError) throw new Error(h.readError);
        return h.readId;
      },
    }),
    gmailSend: () => ({
      send: async (raw: string, opts?: { threadId?: string }) => {
        if (h.sendError) throw new Error(h.sendError);
        h.sends.push({ raw, opts });
        return { id: "gm-" + h.sends.length, threadId: opts?.threadId ?? "th-new" };
      },
    }),
  };
});

import { executeApproval, sendEmail, sweepStaleExecuting } from "./executor";

const row = (over: Row = {}): Row => ({
  id: "a1", agent: "riley", action_type: "email_send", status: "approved", reviewed_by: "brian",
  payload: { to: ["lead@x.org"], cc: [], subject: "Hello", body_text: "Body", drafted_by: "riley" },
  ...over,
});

beforeEach(() => {
  h.rows = []; h.messages = {}; h.sends = []; h.sendError = null; h.rpcCalls = []; h.rpcError = null; h.contacts = new Map(); h.lookups = []; h.readId = null; h.readError = null; h.readHang = false;
});

describe("executeApproval", () => {
  it("double_execute_sends_once", async () => {
    h.rows.push(row());
    const [a, b] = await Promise.all([executeApproval("a1"), executeApproval("a1")]);
    expect(h.sends).toHaveLength(1);
    expect([a.status, b.status].sort()).toEqual(["done", "skipped"]);
    expect(h.rows[0].status).toBe("done");
    expect(h.rows[0].executed_at).toBeTruthy();
    expect((h.rows[0].result as Row).gmail_message_id).toBe("gm-1");
    expect((await executeApproval("a1")).status).toBe("skipped");
    expect(h.sends).toHaveLength(1);
  });

  it("failed_send_marks_failed_with_error", async () => {
    h.rows.push(row());
    h.sendError = "gmail 500";
    const r = await executeApproval("a1");
    expect(r).toEqual({ status: "failed", error: "gmail 500" });
    expect(h.rows[0].status).toBe("failed");
    expect(h.rows[0].error).toBe("gmail 500");
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("rejects_non_email_send_action", async () => {
    h.rows.push(row({ action_type: "publish_post" }));
    expect(await executeApproval("a1")).toEqual({ status: "skipped" });
    expect(h.rows[0].status).toBe("approved");
    expect(h.sends).toHaveLength(0);
  });

  it("reapproved_done_row_is_not_sent_again", async () => {
    h.rows.push(row());
    expect((await executeApproval("a1")).status).toBe("done");
    h.rows[0].status = "approved"; // someone flips it back
    expect(await executeApproval("a1")).toEqual({ status: "skipped" });
    expect(h.sends).toHaveLength(1);
  });

  it("unreviewed_approved_row_is_not_sent", async () => {
    h.rows.push(row({ reviewed_by: null }));
    expect(await executeApproval("a1")).toEqual({ status: "skipped" });
    expect(h.sends).toHaveLength(0);
    expect(h.rows[0].status).toBe("approved");
  });

  it("stored_sent_message_has_rfc_message_id", async () => {
    h.rows.push(row());
    await executeApproval("a1");
    const mid = (h.rpcCalls[0].args.p.message as Row).rfc_message_id as string;
    expect(mid).toMatch(/^<[0-9a-f-]{36}@rosably\.com>$/);
    expect(h.sends[0].raw).toContain(`Message-ID: ${mid}`);
    expect(h.sends[0].raw).toMatch(/^Date: /m);
  });

  it("stores_gmail_assigned_message_id_when_readable", async () => {
    h.rows.push(row());
    h.readId = "<CAF123@mail.gmail.com>";
    expect((await executeApproval("a1")).status).toBe("done");
    expect((h.rpcCalls[0].args.p.message as Row).rfc_message_id).toBe("<CAF123@mail.gmail.com>");
  });

  it("message_id_readback_failure_falls_back_to_generated", async () => {
    h.rows.push(row());
    h.readError = "gmail 503";
    const r = await executeApproval("a1");
    expect(r.status).toBe("done");
    expect((h.rpcCalls[0].args.p.message as Row).rfc_message_id).toMatch(/^<[0-9a-f-]{36}@rosably\.com>$/);
  });

  it("message_id_readback_timeout_falls_back_to_generated", async () => {
    vi.useFakeTimers();
    try {
      h.rows.push(row());
      h.readHang = true;
      const p = executeApproval("a1");
      await vi.advanceTimersByTimeAsync(5001);
      expect((await p).status).toBe("done");
      expect((h.rpcCalls[0].args.p.message as Row).rfc_message_id).toMatch(/^<[0-9a-f-]{36}@rosably\.com>$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips pending (unapproved) rows", async () => {
    h.rows.push(row({ status: "pending" }));
    expect(await executeApproval("a1")).toEqual({ status: "skipped" });
    expect(h.sends).toHaveLength(0);
  });

  it("executor_threads_reply_to_original", async () => {
    h.rows.push(row({ payload: { to: ["lead@x.org"], subject: "Re: Hi", body_text: "B", reply_to_email_message_id: "11111111-1111-4111-8111-111111111111" } }));
    h.messages["11111111-1111-4111-8111-111111111111"] = { rfc_message_id: "<orig@mail.x.org>", thread_id: "th-orig" };
    const r = await executeApproval("a1");
    expect(r.status).toBe("done");
    expect(h.sends[0].opts).toEqual({ threadId: "th-orig" });
    expect(h.sends[0].raw).toMatch(/^In-Reply-To: <orig@mail\.x\.org>\r?$/m);
    expect(h.sends[0].raw).toMatch(/^References: <orig@mail\.x\.org>\r?$/m);
    expect(h.sends[0].raw).toMatch(/^From: Brian Rosenfelt <brian@rosably\.com>\r?$/m);
  });

  it("executor_only_sends_to_payload_recipients", async () => {
    h.rows.push(row({ payload: { to: ["Lead@X.org"], cc: ["cc@x.org"], subject: "S", body_text: "B", contact_id: "c9", bcc: ["evil@x.org"], from: "evil@x.org" } }));
    await executeApproval("a1");
    const raw = h.sends[0].raw;
    expect(raw).toMatch(/^To: .*lead@x\.org/im);
    expect(raw).toMatch(/^Cc: .*cc@x\.org/im);
    expect(raw).not.toContain("evil@x.org");
  });

  it("invalid recipients fail without sending", async () => {
    h.rows.push(row({ payload: { to: ["not-an-email"], subject: "S", body_text: "B" } }));
    const r = await executeApproval("a1");
    expect(r.status).toBe("failed");
    expect(h.sends).toHaveLength(0);
    expect(h.rows[0].status).toBe("failed");
  });

  it("stores the sent message with source executor and contact links", async () => {
    h.rows.push(row());
    h.contacts.set("lead@x.org", { contact_id: "c1", lead_id: "l1", client_id: null });
    await executeApproval("a1");
    expect(h.rpcCalls).toHaveLength(1);
    const p = h.rpcCalls[0].args.p as { message: Row; links: Row[]; activity: Row };
    expect(h.rpcCalls[0].fn).toBe("store_ingested_email");
    expect(p.message).toMatchObject({ gmail_message_id: "gm-1", thread_id: "th-new", direction: "sent", source: "executor", from_email: "brian@rosably.com", to_emails: ["lead@x.org"] });
    expect(p.links).toEqual([{ contact_id: "c1", lead_id: "l1", client_id: null }]);
    expect(p.activity).toMatchObject({ activity_type: "email_sent", email_direction: "sent" });
  });

  it("store_failure_after_send_keeps_done", async () => {
    h.rows.push(row());
    h.rpcError = "db down";
    const r = await executeApproval("a1");
    expect(r.status).toBe("done");
    expect(h.sends).toHaveLength(1);
    expect(h.rows[0].status).toBe("done");
    expect((h.rows[0].result as Row).store_error).toMatch(/db down/);
    expect((h.rows[0].result as Row).gmail_message_id).toBe("gm-1");
  });
});

describe("sendEmail (compose)", () => {
  it("stores with source compose and returns ids", async () => {
    const r = await sendEmail({ to: ["a@x.org"], cc: [], subject: "S", body_text: "B" }, "compose");
    expect(r).toMatchObject({ gmail_message_id: "gm-1", thread_id: "th-new" });
    expect((h.rpcCalls[0].args.p.message as Row).source).toBe("compose");
  });
  it("fails when the reply target is missing, without sending", async () => {
    await expect(sendEmail({ to: ["a@x.org"], cc: [], subject: "S", body_text: "B", reply_to_email_message_id: "22222222-2222-4222-8222-222222222222" }, "compose")).rejects.toThrow(/reply/i);
    expect(h.sends).toHaveLength(0);
  });
});

describe("sweepStaleExecuting", () => {
  it("stale_executing_swept", async () => {
    const old = new Date(Date.now() - 11 * 60_000).toISOString();
    const fresh = new Date(Date.now() - 2 * 60_000).toISOString();
    h.rows.push(row({ id: "old", status: "executing", executing_since: old }), row({ id: "new", status: "executing", executing_since: fresh }), row({ id: "ok", status: "approved" }));
    const n = await sweepStaleExecuting();
    expect(n).toBe(1);
    const by = (id: string) => h.rows.find((r) => r.id === id)!;
    expect(by("old")).toMatchObject({ status: "failed", error: "stale executing" });
    expect(by("new").status).toBe("executing");
    expect(by("ok").status).toBe("approved");
  });
});
