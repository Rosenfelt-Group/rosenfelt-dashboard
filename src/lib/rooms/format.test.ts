import { describe, it, expect } from "vitest";
import { formatVersionDate, formatRelativeTitle } from "./format";

describe("formatVersionDate", () => {
  it("formats as 'Oct 14, 2026'", () => {
    expect(formatVersionDate("2026-10-14T12:00:00Z", "UTC")).toBe("Oct 14, 2026");
    expect(formatVersionDate(new Date("2026-01-05T12:00:00Z"), "UTC")).toBe("Jan 5, 2026");
  });
  it("uses the given time zone at day boundaries", () => {
    expect(formatVersionDate("2026-10-15T03:00:00Z", "UTC")).toBe("Oct 15, 2026");
    expect(formatVersionDate("2026-10-15T03:00:00Z", "America/Los_Angeles")).toBe("Oct 14, 2026");
  });
  it("returns an empty string for an invalid date", () => {
    expect(formatVersionDate("not a date")).toBe("");
  });
});

describe("formatVersionDate edge cases", () => {
  it("returns empty for null, undefined and empty string", () => {
    expect(formatVersionDate(null)).toBe("");
    expect(formatVersionDate(undefined)).toBe("");
    expect(formatVersionDate("")).toBe("");
  });
  it("returns empty for an invalid Date object", () => {
    expect(formatVersionDate(new Date("nope"))).toBe("");
  });
  it("handles pre-1970 and far-future dates", () => {
    expect(formatVersionDate("1969-07-20T12:00:00Z", "UTC")).toBe("Jul 20, 1969");
    expect(formatVersionDate("2999-12-31T12:00:00Z", "UTC")).toBe("Dec 31, 2999");
  });
  it("handles a positive-offset zone at midnight UTC", () => {
    expect(formatVersionDate("2026-10-14T00:00:00Z", "UTC")).toBe("Oct 14, 2026");
    expect(formatVersionDate("2026-10-14T00:00:00Z", "Asia/Tokyo")).toBe("Oct 14, 2026");
    expect(formatVersionDate("2026-10-13T16:00:00Z", "Asia/Tokyo")).toBe("Oct 14, 2026");
  });
  it("returns empty for an invalid time zone", () => {
    expect(formatVersionDate("2026-10-14T12:00:00Z", "Not/AZone")).toBe("");
  });
});

describe("formatRelativeTitle", () => {
  it("does not throw and returns undefined for bad input", () => {
    expect(formatRelativeTitle("")).toBeUndefined();
    expect(formatRelativeTitle(null)).toBeUndefined();
    expect(formatRelativeTitle("garbage")).toBeUndefined();
  });
  it("returns relative text for a valid date", () => {
    expect(formatRelativeTitle(new Date(Date.now() - 3 * 24 * 3600 * 1000))).toBe("3 days ago");
  });
});
