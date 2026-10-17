import { describe, expect, it } from "vitest";
import {
  buildFilters,
  comparePhaseStep,
  filtersToQuery,
  matchesFilters,
  parsePhases,
  sortByPhaseThenPriority,
} from "./work-filters";
import type { WorkItem } from "@/types";

function item(over: Partial<WorkItem>): WorkItem {
  return {
    id: "x",
    priority: "medium",
    updated_at: "2026-01-01T00:00:00Z",
    sprint_number: null,
    phase_step: null,
    assigned_agent: null,
    work_type: "operations",
    source: "manual",
    work_item_type: "internal",
    status: "inbox",
    ...over,
  } as WorkItem;
}

describe("comparePhaseStep", () => {
  it("compares segments numerically and sorts nulls last", () => {
    expect(comparePhaseStep("1.9", "1.10")).toBeLessThan(0);
    expect(comparePhaseStep("2.0", "1.10")).toBeGreaterThan(0);
    expect(comparePhaseStep(null, "1.0")).toBe(1);
    expect(comparePhaseStep("  ", null)).toBe(0);
  });
});

describe("parsePhases", () => {
  it("treats absent or 'all' as no restriction and floors buckets", () => {
    expect(parsePhases(null).size).toBe(0);
    expect(parsePhases("all").size).toBe(0);
    expect(Array.from(parsePhases("1.6,none,2,-1,x"))).toEqual([1, "none", 2]);
  });
});

describe("buildFilters / filtersToQuery", () => {
  it("round-trips and drops unknown values", () => {
    const f = buildFilters(new URLSearchParams("agent=riley,bogus&phase=2,none&itemType=client&q=%20hi%20&searchAll=1"));
    expect(Array.from(f.agents)).toEqual(["riley"]);
    expect(f.itemType).toBe("client");
    expect(f.q).toBe("hi");
    expect(filtersToQuery(f)).toBe("agent=riley&phase=none%2C2&itemType=client&q=hi&searchAll=1");
  });

  it("always serializes phase, as 'all' when empty", () => {
    expect(filtersToQuery(buildFilters(new URLSearchParams()))).toBe("phase=all");
  });
});

describe("matchesFilters", () => {
  it("applies phase buckets and the itemType guard", () => {
    const f = buildFilters(new URLSearchParams("phase=1"));
    expect(matchesFilters(item({ sprint_number: 1.6 }), f)).toBe(true);
    expect(matchesFilters(item({ sprint_number: 2 }), f)).toBe(false);
    expect(matchesFilters(item({ work_item_type: "client" }), buildFilters(new URLSearchParams()))).toBe(false);
  });
});

describe("sortByPhaseThenPriority", () => {
  it("orders by phase, then step, then priority; un-phased last", () => {
    const list = [
      item({ id: "none-high", priority: "high" }),
      item({ id: "p2", sprint_number: 2 }),
      item({ id: "p1-step10", sprint_number: 1, phase_step: "1.10" }),
      item({ id: "p1-step9", sprint_number: 1.5, phase_step: "1.9" }),
    ];
    expect(list.sort(sortByPhaseThenPriority).map((i) => i.id)).toEqual([
      "p1-step9",
      "p1-step10",
      "p2",
      "none-high",
    ]);
  });
});
