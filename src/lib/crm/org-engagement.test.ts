import { describe, expect, it } from "vitest";
import { assignToDeals, dealJourney, defaultDealId } from "./org-engagement";
import type { RoomSummary } from "./org-engagement";

const room = (o: Partial<RoomSummary> = {}): RoomSummary => ({ id: "r", title: "R", relationship: "prospect", status: "active", lead_id: null, created_at: "2026-01-01", shared_versions: 0, active_links: 0, last_opened_at: null, ...o });
const scope = { id: "s", title: "S", lead_id: "l", client_id: null, engagement_type: null, delivery_model: null, current_version_no: 1, current_decided_at: null, proposals: [] };
const invite = { id: "i", project_title: "P", status: "sent", sent_at: null, opened_at: null, submitted_at: null, expires_at: "2027-01-01", created_at: "2026-01-01", brief_status: null, contact: null };

describe("dealJourney", () => {
  it("is -1 before anything starts", () => expect(dealJourney({ discovery: [], scope: null, rooms: [], client_id: null })).toBe(-1));
  it("discovery", () => expect(dealJourney({ discovery: [invite], scope: null, rooms: [], client_id: null })).toBe(0));
  it("an unshared room alone is still discovery-stage", () => expect(dealJourney({ discovery: [], scope: null, rooms: [room()], client_id: null })).toBe(0));
  it("scope", () => expect(dealJourney({ discovery: [invite], scope, rooms: [room()], client_id: null })).toBe(1));
  it("room once something is shared or a link exists", () => {
    expect(dealJourney({ discovery: [], scope, rooms: [room({ shared_versions: 1 })], client_id: null })).toBe(2);
    expect(dealJourney({ discovery: [], scope: null, rooms: [room({ active_links: 1 })], client_id: null })).toBe(2);
  });
  it("delivery once a client record exists", () => expect(dealJourney({ discovery: [], scope: null, rooms: [], client_id: "c" })).toBe(3));
});

describe("assignToDeals", () => {
  it("uses lead_id, gives orphans to a single deal, and leaves them unassigned otherwise", () => {
    const rows = [{ id: 1, lead_id: "a" }, { id: 2, lead_id: null }, { id: 3, lead_id: "zzz" }];
    const one = assignToDeals(rows, ["a"]);
    expect(one.byDeal.get("a")!.map((r) => r.id)).toEqual([1, 2]);
    expect(one.unassigned.map((r) => r.id)).toEqual([3]);
    const two = assignToDeals(rows, ["a", "b"]);
    expect(two.byDeal.get("a")!.map((r) => r.id)).toEqual([1]);
    expect(two.unassigned.map((r) => r.id)).toEqual([2, 3]);
  });
});

describe("defaultDealId", () => {
  it("prefers the newest open deal", () => {
    expect(defaultDealId([
      { id: "won", stage: "won", created_at: "2026-03-01" },
      { id: "open-old", stage: "new", created_at: "2026-01-01" },
      { id: "open-new", stage: "proposal", created_at: "2026-02-01" },
    ])).toBe("open-new");
    expect(defaultDealId([{ id: "lost", stage: "lost", created_at: "2026-01-01" }])).toBe("lost");
    expect(defaultDealId([])).toBeNull();
  });
});
