import { describe, it, expect } from "vitest";
import { pageFromRows, rowToItem, type TimelineRow } from "./timeline";

const email: TimelineRow = {
  kind: "email", id: "m1", ts: "2026-01-03T00:00:00Z", activity_id: "a1", email_message_id: "m1",
  payload: { direction: "received", from_email: "a@b.co", to_emails: ["x@y.co"], subject: "S", preview: "p", body_truncated: true, logged_by: "system", metadata: { email_message_id: "m1" } },
};
const act: TimelineRow = { kind: "activity", id: "a2", ts: "2026-01-02T00:00:00Z", activity_id: "a2", email_message_id: null, payload: { activity_type: "note", content: "n", logged_by: "brian" } };

describe("timeline mapping", () => {
  it("maps email rows, carrying activity id and metadata", () => {
    expect(rowToItem(email)).toMatchObject({ kind: "email", id: "m1", activity_id: "a1", preview: "p", body_truncated: true, metadata: { email_message_id: "m1" } });
    expect(rowToItem(email)).not.toHaveProperty("body_text");
  });
  it("maps activity rows", () => {
    expect(rowToItem(act)).toMatchObject({ kind: "activity", id: "a2", activity_type: "note", content: "n" });
  });
  it("next_cursor is the last row when the page is full, else null", () => {
    expect(pageFromRows([email, act], 2).next_cursor).toEqual({ before_ts: act.ts, before_id: "a2" });
    expect(pageFromRows([email, act], 50).next_cursor).toBeNull();
  });
});
