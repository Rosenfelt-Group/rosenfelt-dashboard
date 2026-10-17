import { describe, expect, it } from "vitest";
import { activeSubPageHref, pathMatches } from "./nav-match";

describe("pathMatches", () => {
  it("matches the path itself and pages beneath it", () => {
    expect(pathMatches("/crm", "/crm")).toBe(true);
    expect(pathMatches("/crm", "/crm/leads/abc")).toBe(true);
  });
  it("does not match a sibling that shares a prefix", () => {
    expect(pathMatches("/crm", "/crmx")).toBe(false);
  });
});

describe("activeSubPageHref", () => {
  const crm = [
    { href: "/crm" },
    { href: "/crm/leads" },
    { href: "/crm/rooms", match: ["/engagements"] },
  ];

  it("picks the longest matching href, not the parent", () => {
    expect(activeSubPageHref(crm, "/crm/leads/123")).toBe("/crm/leads");
    expect(activeSubPageHref(crm, "/crm")).toBe("/crm");
  });

  it("falls back to the parent for unlisted children", () => {
    expect(activeSubPageHref(crm, "/crm/businesses/9")).toBe("/crm");
  });

  it("honours extra match prefixes", () => {
    expect(activeSubPageHref(crm, "/engagements/42")).toBe("/crm/rooms");
  });

  it("returns null when nothing matches", () => {
    expect(activeSubPageHref(crm, "/content")).toBeNull();
  });
});
