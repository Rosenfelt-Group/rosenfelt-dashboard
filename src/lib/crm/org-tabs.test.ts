import { describe, expect, it } from "vitest";
import { orgTabForBusinessTab, parseOrgTab, visibleOrgTabs } from "./org-tabs";

describe("org tabs", () => {
  it("shows Billing, Time and Work only with a client record", () => {
    expect(visibleOrgTabs(false).map((t) => t.id)).toEqual(["activity", "engagement", "research"]);
    expect(visibleOrgTabs(true).map((t) => t.id)).toEqual(["activity", "engagement", "billing", "time", "work", "research"]);
  });
  it("parses ?tab= with fallbacks", () => {
    expect(parseOrgTab("billing", true)).toBe("billing");
    expect(parseOrgTab("billing", false)).toBe("activity");
    expect(parseOrgTab("nope", true)).toBe("activity");
    expect(parseOrgTab(null, false)).toBe("activity");
  });
  it("maps the old business tabs", () => {
    expect(orgTabForBusinessTab("rooms")).toBe("engagement");
    expect(orgTabForBusinessTab("clients")).toBe("billing");
    expect(orgTabForBusinessTab("research")).toBe("research");
    expect(orgTabForBusinessTab("contacts")).toBeNull();
  });
});
