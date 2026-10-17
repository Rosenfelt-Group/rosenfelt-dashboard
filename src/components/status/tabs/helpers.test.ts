import { describe, expect, it } from "vitest";
import { decodeHtmlEntities, formatUptime, parseKickSummary, runMeta, vercelStateMeta } from "./helpers";

describe("formatUptime", () => {
  it("formats days+hours, hours+minutes and minutes", () => {
    expect(formatUptime(2 * 86400 + 3 * 3600 + 59)).toBe("2d 3h");
    expect(formatUptime(3600 + 5 * 60)).toBe("1h 5m");
    expect(formatUptime(42 * 60)).toBe("42m");
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes numeric, hex and named entities and leaves unknown ones", () => {
    expect(decodeHtmlEntities("It&#8217;s &amp; &#x2014; &hellip; &bogus;")).toBe("It’s & — … &bogus;");
  });
});

describe("parseKickSummary", () => {
  it("parses money and period", () => {
    expect(parseKickSummary("income=$1,200.50, expenses=$300, net=$-50 (last 30 days, 2026-09-01..2026-09-30)")).toEqual({
      income: "1,200.50", expenses: "300", net: "-50",
      periodLabel: "last 30 days", start: "2026-09-01", end: "2026-09-30",
    });
  });
  it("returns null for empty or unrecognised input", () => {
    expect(parseKickSummary(null)).toBeNull();
    expect(parseKickSummary("something else")).toBeNull();
  });
});

describe("status metas", () => {
  it("maps run and deployment states", () => {
    expect(runMeta("in_progress", null).label).toBe("Running");
    expect(runMeta("completed", "failure").label).toBe("Failed");
    expect(vercelStateMeta("CANCELED").label).toBe("Cancelled");
    expect(vercelStateMeta("WEIRD").label).toBe("WEIRD");
  });
});
