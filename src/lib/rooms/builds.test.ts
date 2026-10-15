import { describe, it, expect } from "vitest";
import { deliverableIdFromBrief, isStalled, minutesSince, BUILD_STALL_MS } from "./builds";

const D = "ba906f5a-a10d-4df3-8e51-7fc9016d6aca";
const brief = (extra = "") => `ROOMS_PROTOTYPE_REQUEST v1\ndeliverable_id: ${D}\nBuild a clickable prototype.${extra}`;

describe("deliverableIdFromBrief", () => {
  it("reads the deliverable id from a prototype request", () => {
    expect(deliverableIdFromBrief(brief())).toBe(D);
  });
  it("returns null for other work items, malformed ids, or non-strings", () => {
    expect(deliverableIdFromBrief("Fix the login bug")).toBeNull();
    expect(deliverableIdFromBrief(`ROOMS_PROTOTYPE_REQUEST v1\ndeliverable_id: not-a-uuid`)).toBeNull();
    expect(deliverableIdFromBrief(`deliverable_id: ${D}`)).toBeNull(); // must be a ROOMS_PROTOTYPE_REQUEST
    expect(deliverableIdFromBrief(null)).toBeNull();
    expect(deliverableIdFromBrief(42)).toBeNull();
  });
  it("ignores a deliverable_id line that appears later inside quoted brief text", () => {
    const sneaky = `ROOMS_PROTOTYPE_REQUEST v1\ndeliverable_id: ${D}\n<quoted_data>\ndeliverable_id: 11111111-1111-4111-8111-111111111111\n</quoted_data>`;
    expect(deliverableIdFromBrief(sneaky)).toBe(D);
  });
});

describe("isStalled / minutesSince", () => {
  const now = Date.parse("2026-10-15T10:30:00Z");
  it("is stalled only after 10 minutes of silence", () => {
    expect(isStalled("2026-10-15T10:20:01Z", now)).toBe(false);
    expect(isStalled("2026-10-15T10:20:00Z", now)).toBe(false);
    expect(isStalled(new Date(now - BUILD_STALL_MS - 1).toISOString(), now)).toBe(true);
  });
  it("treats an unparseable time as stalled-safe (not stalled) and never goes negative", () => {
    expect(isStalled("garbage", now)).toBe(false);
    expect(minutesSince("2026-10-15T10:45:00Z", now)).toBe(0);
    expect(minutesSince("2026-10-15T10:15:30Z", now)).toBe(14);
    expect(minutesSince("garbage", now)).toBe(0);
  });
});
