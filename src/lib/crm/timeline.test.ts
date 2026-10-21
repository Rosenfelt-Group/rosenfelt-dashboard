import { describe, it, expect } from "vitest";
import { buildTimeline, TIMELINE_PAGE, PREVIEW_CHARS, type ActivityRow, type EmailRow } from "./timeline";

const act = (id: string, ts: string, extra: Partial<ActivityRow> = {}): ActivityRow => ({
  id, created_at: ts, activity_type: "note", content: "n", email_direction: null, email_subject: null, logged_by: "brian", lead_id: null, contact_id: "c", metadata: null, ...extra,
});
const msg = (id: string, ts: string, extra: Partial<EmailRow> = {}): EmailRow => ({
  id, gmail_message_id: "g" + id, thread_id: "t", direction: "received", from_email: "a@b.co", from_name: "A", to_emails: ["brian@rosably.com"], cc_emails: [],
  subject: "Hi", snippet: "snip", body_text: "x".repeat(900), sent_at: ts, created_at: ts, ...extra,
});

describe("buildTimeline", () => {
  it("merges newest first", () => {
    const t = buildTimeline([act("a1", "2026-01-02T00:00:00Z")], [msg("m1", "2026-01-03T00:00:00Z"), msg("m0", "2026-01-01T00:00:00Z")], undefined);
    expect(t.map((i) => i.id)).toEqual(["m1", "a1", "m0"]);
  });
  it("shows an email once and carries the activity metadata", () => {
    const a = act("a1", "2026-01-03T00:05:00Z", { activity_type: "email_received", metadata: { email_message_id: "m1", gmail_message_id: "gm1" }, logged_by: "system" });
    const t = buildTimeline([a], [msg("m1", "2026-01-03T00:00:00Z")], undefined);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kind: "email", id: "m1", activity_id: "a1", metadata: { email_message_id: "m1", gmail_message_id: "gm1" } });
  });
  it("keeps an email activity whose message is missing, and manual email logs", () => {
    const t = buildTimeline([
      act("a1", "2026-01-02T00:00:00Z", { activity_type: "email_sent", metadata: { email_message_id: "gone" } }),
      act("a2", "2026-01-01T00:00:00Z", { activity_type: "email_sent", email_subject: "manual" }),
    ], [], undefined);
    expect(t.map((i) => i.kind)).toEqual(["activity", "activity"]);
  });
  it("returns a preview, and the full body only when requested", () => {
    const t = buildTimeline([], [msg("m1", "2026-01-03T00:00:00Z"), msg("m2", "2026-01-02T00:00:00Z")], "m2");
    const [a, b] = t as Extract<(typeof t)[number], { kind: "email" }>[];
    expect(a.preview).toHaveLength(PREVIEW_CHARS);
    expect(a.body_text).toBeUndefined();
    expect(a.body_truncated).toBe(true);
    expect(b.body_text).toHaveLength(900);
    expect(b.body_truncated).toBe(false);
  });
  it("paginates to 50", () => {
    const msgs = Array.from({ length: 60 }, (_, i) => msg("m" + i, new Date(Date.UTC(2026, 0, 1, 0, 0, 60 - i)).toISOString()));
    const t = buildTimeline([], msgs, undefined);
    expect(t).toHaveLength(TIMELINE_PAGE);
    expect(t[0].id).toBe("m0");
  });
  it("falls back to created_at when sent_at is null", () => {
    const t = buildTimeline([], [msg("m1", "2026-01-03T00:00:00Z", { sent_at: null, created_at: "2026-02-01T00:00:00Z" })], undefined);
    expect(t[0].ts).toBe("2026-02-01T00:00:00Z");
  });
});
