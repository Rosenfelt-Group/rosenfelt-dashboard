import { describe, it, expect } from "vitest";
import { formatVersionDate } from "./format";

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
