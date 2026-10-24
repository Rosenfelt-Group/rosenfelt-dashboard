import { describe, expect, it } from "vitest";
import { compareTimeline, filterTimeline, mergeTimeline, orgPageFromRows, orgRowToItem, parseTimelineFilter, sortUpcoming, timelineCategory, upcomingDate, type OrgTimelineItem, type UpcomingItem } from "./org-timeline";

const act = (id: string, ts: string, extra: Partial<Record<string, unknown>> = {}) =>
  ({ kind: "activity", id, ts, activity_type: "note", content: null, email_direction: null, email_subject: null, logged_by: "brian", lead_id: null, metadata: null, ...extra }) as OrgTimelineItem;

describe("orgRowToItem", () => {
  it("maps room events and scope versions", () => {
    const r = orgRowToItem({ kind: "room_event", id: "a", ts: "2026-01-01T00:00:00Z", activity_id: null, email_message_id: null,
      payload: { event_type: "room_opened", engagement_id: "e1", room_title: "Room", contact_name: null, meta: {} } });
    expect(r).toMatchObject({ kind: "room_event", event_type: "room_opened", engagement_id: "e1", room_title: "Room" });
    const s = orgRowToItem({ kind: "scope", id: "v", ts: "2026-01-01T00:00:00Z", activity_id: null, email_message_id: null,
      payload: { scope_document_id: "d", title: "Scope", version_no: 2, status: "proposed", source: "riley" } });
    expect(s).toMatchObject({ kind: "scope", version_no: 2, status: "proposed", scope_document_id: "d" });
  });
  it("keeps the contact id on emails and activities", () => {
    const e = orgRowToItem({ kind: "email", id: "m", ts: "2026-01-01T00:00:00Z", activity_id: null, email_message_id: "m",
      payload: { direction: "received", to_emails: [], contact_id: "c1" } });
    expect(e).toMatchObject({ kind: "email", contact_id: "c1" });
  });
  it("sets a cursor only on a full page", () => {
    const rows = [{ kind: "activity" as const, id: "1", ts: "2026-01-02T00:00:00Z", activity_id: "1", email_message_id: null, payload: {} },
      { kind: "activity" as const, id: "2", ts: "2026-01-01T00:00:00Z", activity_id: "2", email_message_id: null, payload: {} }];
    expect(orgPageFromRows(rows, 2).next_cursor).toEqual({ before_ts: "2026-01-01T00:00:00Z", before_id: "2" });
    expect(orgPageFromRows(rows, 3).next_cursor).toBeNull();
  });
});

describe("mergeTimeline", () => {
  it("dedupes by kind and id, preferring the head copy, and sorts newest first", () => {
    const head = [act("b", "2026-01-03T00:00:00Z", { content: "fresh" }), act("a", "2026-01-01T00:00:00Z")];
    const older = [act("b", "2026-01-03T00:00:00Z", { content: "stale" }), act("c", "2026-01-02T00:00:00Z")];
    const out = mergeTimeline(head, older);
    expect(out.map((i) => i.id)).toEqual(["b", "c", "a"]);
    expect((out[0] as { content: string }).content).toBe("fresh");
  });
  it("the same id under a different kind is a different item", () => {
    const scope = { kind: "scope", id: "x", ts: "2026-01-01T00:00:00Z" } as OrgTimelineItem;
    expect(mergeTimeline([act("x", "2026-01-01T00:00:00Z")], [scope])).toHaveLength(2);
  });
  it("breaks timestamp ties by id descending, like the SQL keyset", () => {
    expect([{ ts: "2026-01-01T00:00:00Z", id: "a" }, { ts: "2026-01-01T00:00:00Z", id: "b" }].sort(compareTimeline).map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("categories and filters", () => {
  const items: OrgTimelineItem[] = [
    { kind: "email", id: "e", ts: "2026-01-01T00:00:00Z", direction: "sent", from_email: null, from_name: null, to_emails: [], cc_emails: [], subject: null, snippet: null, thread_id: null, preview: null, body_truncated: false, activity_id: null, logged_by: null, metadata: null },
    act("d", "2026-01-01T00:00:00Z", { activity_type: "system", content: "Discovery questionnaire sent: Portal" }),
    act("n", "2026-01-01T00:00:00Z"),
    act("m", "2026-01-01T00:00:00Z", { activity_type: "email_sent", email_subject: "Manual log" }),
    act("s", "2026-01-01T00:00:00Z", { activity_type: "stage_change", content: "Stage changed" }),
    { kind: "room_event", id: "r", ts: "2026-01-01T00:00:00Z", event_type: "room_opened", engagement_id: "e", room_title: null, contact_name: null, meta: null },
    { kind: "scope", id: "v", ts: "2026-01-01T00:00:00Z", scope_document_id: "d", title: "S", version_no: 1, status: "current", source: "brief", created_by: null, change_note: null, decided_at: null },
  ];
  it("classifies each kind", () => {
    expect(items.map(timelineCategory)).toEqual(["email", "discovery", "notes", "email", "system", "room", "scope"]);
  });
  it("filters", () => {
    expect(filterTimeline(items, "all")).toHaveLength(7);
    expect(filterTimeline(items, "email").map((i) => i.id)).toEqual(["e", "m"]);
    expect(filterTimeline(items, "room").map((i) => i.id)).toEqual(["r"]);
  });
  it("parses the filter", () => {
    expect(parseTimelineFilter("scope")).toBe("scope");
    expect(parseTimelineFilter("nope")).toBe("all");
  });
});

describe("sortUpcoming", () => {
  it("puts next steps and decisions first, then soonest", () => {
    const u = (kind: UpcomingItem["kind"], id: string, at: string): UpcomingItem => ({ kind, id, at, title: id, detail: null, href: null, lead_id: null });
    const out = sortUpcoming([u("close_date", "c", "2026-11-01"), u("next_step", "n", "2026-12-01"), u("discovery_waiting", "w2", "2026-10-20"), u("scope_proposal", "p", "2026-10-22"), u("discovery_waiting", "w1", "2026-10-10"), u("brief_ready", "b", "2026-10-23")]);
    expect(out.map((i) => i.id)).toEqual(["n", "p", "b", "w1", "w2", "c"]);
  });
});

describe("upcomingDate", () => {
  it("keeps plain dates on their day", () => {
    expect(upcomingDate("2026-10-25").getDate()).toBe(25);
    expect(upcomingDate("2026-10-25T15:00:00Z").toISOString()).toBe("2026-10-25T15:00:00.000Z");
  });
});
