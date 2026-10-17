import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// The Code-node source is plain JS (no imports) so it can be pasted into n8n; load it through require.
type Row = Record<string, unknown> & { event_key: string; record_type: string; recipient: string; source_group: string };
type Normalized = { row: Row | null; ping: string | null };
const code = createRequire(import.meta.url)("./postmark-events.code.js") as {
  normalize(body: unknown): Normalized;
  sourceLabel(tag: string | null): string;
  secretMatches(given: unknown, expected: unknown): boolean;
  recentPingQuery(row: Row, nowMs: number): string | null;
  pingDecision(n: Normalized, insertBody: unknown, recentResponse: string): { send: boolean; text: string | null };
};

const LINK = "https://dashboard.rosably.com/status?tab=email";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const withoutContent = ({ Content, ...rest }: Record<string, unknown>) => rest;
const META = { PropA: "some value", PropB: "some value" };

// Postmark's documented sample payloads (postmarkapp.com/developer/webhooks/*), with our tags where a test needs one.
const hardBounce = {
  RecordType: "Bounce", MessageStream: "outbound", ID: 692560173, Type: "HardBounce", TypeCode: 1, Name: "Hard bounce",
  Tag: "n8n-avery-deliver-audit", MessageID: "883953f4-6105-42a2-a16a-77a8eac79483", Metadata: META, ServerID: 23,
  Description: "The server was unable to deliver your message (ex: unknown user, mailbox not found).",
  Details: "Test bounce details", Email: "margareth@nasa.com", From: "alanturing@computers.com",
  BouncedAt: "2026-11-05T16:33:54.9070259Z", DumpAvailable: true, Inactive: true, CanActivate: true,
  Subject: "Saying Hello!", Content: "<Full dump of bounce>",
};
const softBounce = {
  ...hardBounce, ID: 692560175, Type: "SoftBounce", TypeCode: 4096, Name: "Soft bounce",
  Description: "Unable to temporarily deliver this message.", Inactive: false, Tag: "dashboard-room-invite",
};
const spam = {
  RecordType: "SpamComplaint", MessageStream: "outbound", ID: 692560174, Type: "SpamComplaint", TypeCode: 100001,
  Name: "Spam complaint", Tag: "dashboard-discovery-invite", MessageID: "883953f4-6105-42a2-a16a-77a8eac79483",
  Metadata: META, ServerID: 23, Description: "The subscriber explicitly marked this message as spam.",
  Details: "Test spam complaint details", Email: "margareth@nasa.com", From: "alanturing@computers.com",
  BouncedAt: "2026-11-05T16:33:54.9070259Z", DumpAvailable: true, Inactive: true, CanActivate: false,
  Subject: "Saying Hello!", Content: "<Abuse report dump>",
};
const subChange = {
  RecordType: "SubscriptionChange", MessageID: "883953f4-6105-42a2-a16a-77a8eac79483", ServerID: 23,
  MessageStream: "outbound", ChangedAt: "2026-11-05T16:33:54.9070259Z", Recipient: "Margareth@NASA.com",
  Origin: "Recipient", SuppressSending: true, SuppressionReason: "HardBounce", Tag: "welcome-email", Metadata: META,
};
const delivery = {
  RecordType: "Delivery", MessageStream: "outbound", ServerID: 23, MessageID: "883953f4-6105-42a2-a16a-77a8eac79483",
  Recipient: "margareth@nasa.com", Tag: "wordpress", DeliveredAt: "2026-11-05T16:33:54.9070259Z",
  Details: "250 2.0.0 OK  1762360434 x12-20020a05 - gsmtp", Metadata: META,
};

describe("normalize: event_key per record type", () => {
  it("uses Postmark's IDs and the subscription-change composite key", () => {
    expect(code.normalize(hardBounce).row?.event_key).toBe("bounce:692560173");
    expect(code.normalize(spam).row?.event_key).toBe("spam:692560174");
    expect(code.normalize(delivery).row?.event_key).toBe("delivery:883953f4-6105-42a2-a16a-77a8eac79483");
    expect(code.normalize(subChange).row?.event_key)
      .toBe("sub:883953f4-6105-42a2-a16a-77a8eac79483:margareth@nasa.com:2026-11-05T16:33:54.9070259Z");
    expect(code.normalize({ ...subChange, MessageID: null }).row?.event_key)
      .toBe("sub::margareth@nasa.com:2026-11-05T16:33:54.9070259Z");
  });
});

describe("normalize: hard bounce", () => {
  const { row, ping } = code.normalize(hardBounce);
  it("maps every column", () => {
    expect(row).toEqual({
      event_key: "bounce:692560173", record_type: "Bounce", message_id: "883953f4-6105-42a2-a16a-77a8eac79483",
      recipient: "margareth@nasa.com", subject: "Saying Hello!", tag: "n8n-avery-deliver-audit", source_group: "n8n",
      bounce_type: "HardBounce", description: hardBounce.Description, inactive: true, can_activate: true,
      metadata: META, occurred_at: "2026-11-05T16:33:54.9070259Z", payload: withoutContent(hardBounce),
    });
  });
  it("never stores the message dump (Content) and leaves the webhook body untouched", () => {
    expect(row?.payload).not.toHaveProperty("Content");
    expect(code.normalize(spam).row?.payload).not.toHaveProperty("Content");
    expect(code.normalize(spam).row?.payload).toMatchObject({ ID: 692560174, Details: "Test spam complaint details" });
    expect(hardBounce.Content).toBe("<Full dump of bounce>");
  });
  it("pings with the exact text", () => {
    expect(ping).toBe(
      `📧 Bounce — margareth@nasa.com didn't get "Saying Hello!" (n8n · avery-deliver-audit). ` +
      `Reason: The server was unable to deliver your message (ex: unknown user, mailbox not found). ` +
      `Postmark has blocked this address. ${LINK}`,
    );
  });
});

describe("normalize: other types", () => {
  it("stores a soft bounce without a ping", () => {
    const { row, ping } = code.normalize(softBounce);
    expect(row?.inactive).toBe(false);
    expect(row?.source_group).toBe("dashboard");
    expect(ping).toBeNull();
  });
  it("always pings a spam complaint", () => {
    const { row, ping } = code.normalize(spam);
    expect(row?.record_type).toBe("SpamComplaint");
    expect(row?.can_activate).toBe(false);
    expect(ping).toBe(
      `🚨 Spam complaint — margareth@nasa.com marked "Saying Hello!" (Dashboard · discovery invite) as spam. ` +
      `They're permanently blocked. ${LINK}`,
    );
  });
  it("pings a block (SuppressSending true) and stores it as inactive", () => {
    const { row, ping } = code.normalize(subChange);
    expect(row).toMatchObject({ record_type: "SubscriptionChange", recipient: "Margareth@NASA.com", inactive: true,
      source_group: "other", subject: null, bounce_type: null, occurred_at: subChange.ChangedAt });
    expect(ping).toBe(`⛔ Blocked — Postmark will no longer send to Margareth@NASA.com (hard bounce). ${LINK}`);
    expect(code.normalize({ ...subChange, SuppressionReason: "ManualSuppression" }).ping).toContain("(blocked manually)");
  });
  it("does not ping a reactivation (SuppressSending false)", () => {
    expect(code.normalize({ ...subChange, SuppressSending: false }).ping).toBeNull();
  });
  it("stores a delivery without a ping, source group from the tag", () => {
    const { row, ping } = code.normalize(delivery);
    expect(row).toMatchObject({ record_type: "Delivery", recipient: "margareth@nasa.com", tag: "wordpress",
      source_group: "wordpress", occurred_at: delivery.DeliveredAt, inactive: null, metadata: META });
    expect(ping).toBeNull();
  });
  it("falls back to 'other' for unknown or missing tags", () => {
    expect(code.normalize({ ...delivery, Tag: "welcome-email" }).row?.source_group).toBe("other");
    expect(code.normalize({ ...delivery, Tag: "" }).row).toMatchObject({ tag: null, source_group: "other" });
  });
  it("ignores record types we do not store", () => {
    expect(code.normalize({ RecordType: "Open", MessageID: "x", Recipient: "a@b.c" })).toEqual({ row: null, ping: null });
  });
});

describe("sourceLabel (same labels as the dashboard)", () => {
  it("names each mail source in plain English", () => {
    expect(code.sourceLabel("dashboard-room-invite")).toBe("Dashboard · room invite");
    expect(code.sourceLabel("dashboard-discovery-invite")).toBe("Dashboard · discovery invite");
    expect(code.sourceLabel("n8n-stripe-buyer")).toBe("n8n · stripe-buyer");
    expect(code.sourceLabel("wordpress")).toBe("WordPress");
    expect(code.sourceLabel(null)).toBe("Other");
  });
});

describe("secretMatches", () => {
  it("accepts only the exact configured secret", () => {
    expect(code.secretMatches("abc123", "abc123")).toBe(true);
    expect(code.secretMatches("abc124", "abc123")).toBe(false);
    expect(code.secretMatches("abc12", "abc123")).toBe(false);
    expect(code.secretMatches("abc1234", "abc123")).toBe(false);
    expect(code.secretMatches(undefined, "abc123")).toBe(false);
    expect(code.secretMatches(["abc123"], "abc123")).toBe(false);
  });
  it("rejects everything when no secret is configured", () => {
    expect(code.secretMatches("", "")).toBe(false);
    expect(code.secretMatches("x", undefined)).toBe(false);
  });
});

describe("ping decision", () => {
  // Insert body (return=representation): the new row, or [] when the event_key already existed.
  const inserted = [{ id: "1" }];
  it("pings only newly inserted rows", () => {
    const n = code.normalize(hardBounce);
    expect(code.pingDecision(n, inserted, "[]")).toEqual({ send: true, text: n.ping });
    expect(code.pingDecision(n, JSON.stringify(inserted), "[]")).toEqual({ send: true, text: n.ping });
    expect(code.pingDecision(n, [], "[]")).toEqual({ send: false, text: null });
    expect(code.pingDecision(code.normalize(delivery), inserted, "[]")).toEqual({ send: false, text: null });
  });
  it("skips a block ping when a bounce/complaint ping went out for that recipient recently", () => {
    const n = code.normalize(subChange);
    expect(code.pingDecision(n, inserted, "[]").send).toBe(true);
    expect(code.pingDecision(n, inserted, JSON.stringify([{ id: "b" }])).send).toBe(false);
  });
  it("fails loudly on an unreadable insert response: the ping is lost, but the error handler alerts", () => {
    expect(() => code.pingDecision(code.normalize(hardBounce), undefined, "[]")).toThrow(/insert response/);
    expect(() => code.pingDecision(code.normalize(hardBounce), { _readableState: {} }, "[]")).toThrow(/insert response/);
  });
  it("does not let recent pings suppress a bounce or complaint", () => {
    expect(code.pingDecision(code.normalize(spam), inserted, JSON.stringify([{ id: "b" }])).send).toBe(true);
  });
});

describe("recentPingQuery", () => {
  it("asks for pinged bounces/complaints to the same recipient in the last 10 minutes", () => {
    const row = code.normalize(subChange).row!;
    const q = code.recentPingQuery(row, Date.parse("2026-11-05T16:40:00Z"))!;
    const p = new URLSearchParams(q);
    expect(p.get("select")).toBe("id");
    expect(p.get("recipient")).toBe("ilike.margareth@nasa.com");
    expect(p.get("received_at")).toBe("gte.2026-11-05T16:30:00.000Z");
    expect(p.get("or")).toBe("(record_type.eq.SpamComplaint,and(record_type.eq.Bounce,inactive.is.true))");
    expect(p.get("limit")).toBe("1");
  });
  it("escapes LIKE wildcards in the address", () => {
    const row = code.normalize({ ...subChange, Recipient: "first_last%x@acme.co" }).row!;
    expect(new URLSearchParams(code.recentPingQuery(row, 0)!).get("recipient")).toBe("ilike.first\\_last\\%x@acme.co");
  });
  it("is only needed for subscription changes", () => {
    expect(code.recentPingQuery(code.normalize(hardBounce).row!, 0)).toBeNull();
  });
});
