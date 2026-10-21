import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  calls: [] as [string, ...unknown[]][],
  results: {} as Record<string, unknown[]>,
  rpcError: null as string | null,
}));

vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      rpc: (name: string, args: unknown) => {
        db.calls.push(["rpc", name, args]);
        return Promise.resolve({ data: {}, error: db.rpcError ? { message: db.rpcError } : null });
      },
      from: (table: string) => {
        let out: unknown = [];
        const b: Record<string, unknown> = {};
        for (const m of ["select", "in", "or", "neq", "order"]) {
          b[m] = (...a: unknown[]) => {
            db.calls.push([`${table}.${m}`, ...a]);
            if (m === "select") out = db.results[table] ?? [];
            return b;
          };
        }
        b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: out, error: null }).then(res);
        return b;
      },
    }),
  },
}));

import { classify, planIngest, applyIngest, loadContactsByEmail, parseAddressList, decodeMimeWords, type ContactRef } from "./ingest";
import type { GmailMessage } from "./gmail-user";

const msg = (headers: Record<string, string>, over: Partial<GmailMessage> = {}): GmailMessage => ({
  id: "g1", threadId: "t1", labelIds: ["INBOX"], internalDate: 1_760_000_000_000, snippet: "snip",
  headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
  bodyText: "", ...over,
});
const ref = (id: string): ContactRef => ({ contact_id: id, lead_id: `lead-${id}`, client_id: null });
const map = (...pairs: [string, ContactRef][]) => new Map(pairs);

beforeEach(() => { db.calls = []; db.results = {}; db.rpcError = null; });

describe("parseAddressList", () => {
  it("handles quoted names containing commas", () => {
    expect(parseAddressList('"Doe, Jane" <Jane@X.com>, bob@y.com')).toEqual([
      { name: "Doe, Jane", email: "jane@x.com" },
      { name: "", email: "bob@y.com" },
    ]);
  });
  it("handles angle-addrs, bare addrs, comments and escaped quotes", () => {
    expect(parseAddressList('Al <al@x.com>, <b@x.com>, c@x.com (Carl), "A \\"Q\\" B" <d@x.com>').map((a) => [a.name, a.email])).toEqual([
      ["Al", "al@x.com"], ["", "b@x.com"], ["", "c@x.com"], ['A "Q" B', "d@x.com"],
    ]);
  });
  it("decodes RFC 2047 names (B and Q)", () => {
    expect(parseAddressList("=?UTF-8?B?Sm9zw6k=?= <j@x.com>")[0].name).toBe("José");
    expect(parseAddressList("=?ISO-8859-1?Q?Andr=E9_Smith?= <a@x.com>")[0].name).toBe("André Smith");
    expect(decodeMimeWords("=?UTF-8?B?SGVs?= =?UTF-8?B?bG8=?=")).toBe("Hello");
  });
  it("drops junk and empty input", () => {
    expect(parseAddressList(undefined)).toEqual([]);
    expect(parseAddressList("undisclosed-recipients:;")).toEqual([]);
  });
});

describe("classify / planIngest", () => {
  it("logs_inbound_from_known_contact", () => {
    const m = msg({ From: "Jane <jane@x.com>", To: "brian@rosably.com" });
    expect(classify(m)).toMatchObject({ direction: "received", participants: ["jane@x.com"], deliveredToCrm: false });
    expect(planIngest(m, map(["jane@x.com", ref("c1")]))).toEqual({ kind: "log", links: [ref("c1")] });
  });
  it("logs_outbound_from_brian_to_contact_in_cc", () => {
    const m = msg({ From: "brian@rosably.com", To: "nobody@z.com", Cc: "jane@x.com" });
    expect(classify(m).direction).toBe("sent");
    expect(planIngest(m, map(["jane@x.com", ref("c1")]))).toEqual({ kind: "log", links: [ref("c1")] });
  });
  it("one_row_two_contacts_two_activities (plan)", () => {
    const m = msg({ From: "brian@rosably.com", To: "a@x.com, b@y.com" });
    const p = planIngest(m, map(["a@x.com", ref("c1")], ["b@y.com", ref("c2")]));
    expect(p).toMatchObject({ kind: "log" });
    expect((p as { links: ContactRef[] }).links).toHaveLength(2);
  });
  it("skips_when_no_contact_and_not_crm", () => {
    expect(planIngest(msg({ From: "rando@x.com", To: "brian@rosably.com" }), new Map())).toEqual({ kind: "skip", reason: "no_contact" });
  });
  it("skips_spam_trash_and_drafts", () => {
    for (const l of ["SPAM", "TRASH", "DRAFT"]) {
      const m = msg({ From: "jane@x.com", To: "brian@rosably.com" }, { labelIds: ["INBOX", l] });
      expect(planIngest(m, map(["jane@x.com", ref("c1")])).kind).toBe("skip");
    }
  });
  it("crm_forward_extracts_original_sender (Gmail and Outlook)", () => {
    const gmail = msg({ From: "Brian <brian@rosably.com>", To: "crm@rosably.com" }, {
      bodyText: "fyi\n\n---------- Forwarded message ---------\nFrom: Pat Lee <pat@new.com>\nDate: Mon\nSubject: Hi\n\nhello",
    });
    expect(classify(gmail)).toEqual({ direction: "received", participants: ["pat@new.com"], deliveredToCrm: true, forwardedOriginal: { email: "pat@new.com", name: "Pat Lee" } });
    expect(planIngest(gmail, new Map())).toEqual({ kind: "unmatched", email: "pat@new.com" });

    const outlook = msg({ From: "brian@rosably.com", To: "crm@rosably.com" }, {
      bodyText: "see below\n\nFrom: Sam Roe <sam@out.com>\nSent: Monday, October 20, 2026 9:00 AM\nTo: Brian\nSubject: Q\n\nbody",
    });
    expect(classify(outlook).forwardedOriginal).toEqual({ email: "sam@out.com", name: "Sam Roe" });
    expect(planIngest(outlook, map(["sam@out.com", ref("c9")]))).toEqual({ kind: "log", links: [ref("c9")] });
  });
  it("crm_bcc_uses_to_recipients", () => {
    const m = msg({ From: "brian@rosably.com", To: "New Person <new@p.com>", "Delivered-To": "crm@rosably.com" }, { bodyText: "Nice to meet you" });
    expect(classify(m)).toMatchObject({ direction: "sent", participants: ["new@p.com"], deliveredToCrm: true });
    expect(planIngest(m, new Map())).toEqual({ kind: "unmatched", email: "new@p.com" });
  });
  it("normalizes_addresses_case_whitespace", () => {
    const m = msg({ From: "  Jane <JANE@X.COM> ", To: "Brian@Rosably.com" });
    expect(classify(m).participants).toEqual(["jane@x.com"]);
    expect(planIngest(m, map(["jane@x.com", ref("c1")])).kind).toBe("log");
  });
  it("detects crm@ via X-Original-To and ignores crm@ as participant", () => {
    const m = msg({ From: "jane@x.com", To: "brian@rosably.com", "X-Original-To": "CRM@Rosably.com" });
    expect(classify(m).deliveredToCrm).toBe(true);
    const m2 = msg({ From: "jane@x.com", To: "crm@rosably.com" });
    expect(classify(m2).participants).toEqual(["jane@x.com"]);
  });
});

describe("applyIngest", () => {
  const rpcCalls = () => db.calls.filter((c) => c[0] === "rpc");
  it("sends one rpc with message, links and activity for a logged message", async () => {
    const m = msg({ From: "brian@rosably.com", To: "a@x.com, b@y.com", Subject: "Hello" });
    await applyIngest(planIngest(m, map(["a@x.com", ref("c1")], ["b@y.com", ref("c2")])), m);
    expect(rpcCalls()).toHaveLength(1);
    const [, name, args] = rpcCalls()[0] as [string, string, { p: Row }];
    expect(name).toBe("store_ingested_email");
    expect(args.p.message).toMatchObject({ gmail_message_id: "g1", direction: "sent", source: "gmail_watch", delivered_to_crm: false, subject: "Hello", to_emails: ["a@x.com", "b@y.com"] });
    expect(args.p.links).toEqual([
      { contact_id: "c1", lead_id: "lead-c1", client_id: null },
      { contact_id: "c2", lead_id: "lead-c2", client_id: null },
    ]);
    expect(args.p.activity).toEqual({ activity_type: "email_sent", email_direction: "sent", email_subject: "Hello", content: "snip" });
    expect(args.p.unmatched).toBeUndefined();
  });
  it("received mail gets email_received", async () => {
    const m = msg({ From: "jane@x.com", To: "brian@rosably.com" });
    await applyIngest(planIngest(m, map(["jane@x.com", ref("c1")])), m);
    expect((rpcCalls()[0][2] as { p: Row }).p.activity).toMatchObject({ activity_type: "email_received", email_direction: "received" });
  });
  it("unmatched: forward source, original sender, unmatched payload, no links", async () => {
    const m = msg({ From: "brian@rosably.com", To: "crm@rosably.com", Subject: "Fwd: Hi" }, {
      bodyText: "---------- Forwarded message ---------\nFrom: Pat <pat@new.com>\n",
    });
    await applyIngest(planIngest(m, new Map()), m);
    const p = (rpcCalls()[0][2] as { p: Row }).p;
    expect(p.message).toMatchObject({ source: "forward", delivered_to_crm: true, direction: "received", from_email: "pat@new.com" });
    expect(p.links).toEqual([]);
    expect(p.unmatched).toEqual({ contact_email: "pat@new.com", subject: "Fwd: Hi", snippet: "snip" });
    expect(p.activity).toBeUndefined();
  });
  it("throws when the rpc fails", async () => {
    db.rpcError = "boom";
    const m = msg({ From: "jane@x.com", To: "brian@rosably.com" });
    await expect(applyIngest(planIngest(m, map(["jane@x.com", ref("c1")])), m)).rejects.toThrow(/boom/);
  });
  it("skip writes nothing", async () => {
    await applyIngest({ kind: "skip", reason: "x" }, msg({}));
    expect(db.calls).toHaveLength(0);
  });
});

describe("loadContactsByEmail", () => {
  it("resolves lead/client per R16 with one query per table", async () => {
    db.results = {
      contacts: [
        { id: "c1", email_norm: "a@x.com", business_id: "b1" },
        { id: "c2", email_norm: "b@x.com", business_id: null },
      ],
      leads: [
        { id: "l-lost", contact_id: "c1", stage: "lost" },
        { id: "l-won", contact_id: "c1", stage: "won" },
        { id: "l-open-old", contact_id: "c1", stage: "new" },
        { id: "l-lost2", contact_id: "c2", stage: "lost" },
      ],
      clients: [{ id: "k1", contact_id: null, business_id: "b1" }],
    };
    const r = await loadContactsByEmail([" A@X.com", "b@x.com", "a@x.com"]);
    expect(r.get("a@x.com")).toEqual({ contact_id: "c1", lead_id: "l-open-old", client_id: "k1" });
    expect(r.get("b@x.com")).toEqual({ contact_id: "c2", lead_id: null, client_id: null });
    const froms = db.calls.filter((c) => c[0].endsWith(".select")).map((c) => c[0]);
    expect(froms).toEqual(["contacts.select", "leads.select", "clients.select"]);
    expect(db.calls).toContainEqual(["contacts.in", "email_norm", ["a@x.com", "b@x.com"]]);
    expect(db.calls).toContainEqual(["clients.neq", "billing_status", "cancelled"]);
  });
  it("chunks lookups into batches of 50 addresses", async () => {
    const emails = Array.from({ length: 120 }, (_, i) => `u${i}@x.com`);
    await loadContactsByEmail(emails);
    const ins = db.calls.filter((c) => c[0] === "contacts.in").map((c) => (c[2] as string[]).length);
    expect(ins).toEqual([50, 50, 20]);
  });
  it("returns empty without querying for no emails", async () => {
    expect((await loadContactsByEmail([])).size).toBe(0);
    expect(db.calls).toHaveLength(0);
  });
});
