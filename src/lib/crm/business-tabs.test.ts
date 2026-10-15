import { describe, it, expect } from "vitest";
import { BUSINESS_TABS, parseBusinessTab } from "./business-tabs";

describe("parseBusinessTab", () => {
  it("lists the tabs in order", () => {
    expect(BUSINESS_TABS.map(t => t.label)).toEqual(["Contacts", "Research", "Rooms", "Discovery", "Leads"]);
  });
  it("accepts known tab ids", () => {
    expect(parseBusinessTab("rooms")).toBe("rooms");
  });
  it("falls back to contacts for missing or unknown values", () => {
    expect(parseBusinessTab(null)).toBe("contacts");
    expect(parseBusinessTab("nope")).toBe("contacts");
  });
});
