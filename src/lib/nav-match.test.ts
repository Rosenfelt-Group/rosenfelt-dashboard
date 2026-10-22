import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { activeSubPageHref, matchingItems, pathMatches } from "./nav-match";
import { ALL_NAV_ITEMS, NAV_GROUPS, SUB_PAGES } from "@/components/nav-config";

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

// ── Every dashboard page maps to exactly one nav item ────────────────────────

const ROOT = path.join(process.cwd(), "src/app/(dashboard)");

/** Page routes from the filesystem; dynamic segments become `__name__` placeholders. */
function pageRoutes(dir = ROOT, prefix = ""): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const seg = /^\(.*\)$/.test(e.name) ? "" : "/" + e.name.replace(/^\[(.+)\]$/, "__$1__");
      out.push(...pageRoutes(path.join(dir, e.name), prefix + seg));
    } else if (e.name === "page.tsx") out.push(prefix || "/");
  }
  return out;
}

describe("nav covers every dashboard route", () => {
  const routes = pageRoutes();

  it("finds the routes", () => {
    expect(routes.length).toBeGreaterThan(20);
    expect(routes).toContain("/crm/people/__contactId__");
    expect(routes).toContain("/crm/scope/__id__");
  });

  it.each(routes)("%s maps to exactly one nav item", route => {
    expect(matchingItems(ALL_NAV_ITEMS, route).map(i => i.id)).toHaveLength(1);
  });

  it("every sub-page link points at a real route", () => {
    const patterns = routes.map(r => new RegExp("^" + r.replace(/__[^_]+__/g, "[^/]+") + "$"));
    for (const pages of Object.values(SUB_PAGES))
      for (const p of pages) expect(patterns.some(re => re.test(p.href.split("?")[0])), p.href).toBe(true);
  });

  it("sub-pages map people, scope and engagements into the CRM", () => {
    const crm = SUB_PAGES.crm;
    expect(activeSubPageHref(crm, "/crm/people/abc")).toBe("/crm/contacts");
    expect(activeSubPageHref(crm, "/crm/scope/abc")).toBe("/crm/scope");
    expect(activeSubPageHref(crm, "/engagements/abc")).toBe("/crm/rooms");
  });
});

describe("nav_has_four_primary_areas", () => {
  it("lists CRM, Research, Content, Calendar in order", () => {
    expect(NAV_GROUPS.primary.map(i => i.label)).toEqual(["CRM", "Research", "Content", "Calendar"]);
  });

  it("CRM children are Pipeline, People, Inbox, Discovery, Scope, Rooms first", () => {
    expect(SUB_PAGES.crm.slice(0, 6).map(p => p.label)).toEqual(["Pipeline", "People", "Inbox", "Discovery", "Scope", "Rooms"]);
  });

  it("secondary keeps Approvals, Agents, System, Tools and nothing is lost", () => {
    const labels = NAV_GROUPS.secondary.map(i => i.label);
    expect(labels.slice(0, 4)).toEqual(["Approvals", "Agents", "System", "Tools"]);
    expect(SUB_PAGES.system.map(p => p.label)).toEqual(["Health", "Email", "Cost"]);
    for (const l of ["Overview", "Work", "Reports", "Documents", "Finance"]) expect(labels).toContain(l);
  });

  it("nav items carry no permission gating of their own (pages and APIs enforce it)", () => {
    for (const i of ALL_NAV_ITEMS) expect(Object.keys(i).sort()).toEqual(["active", "href", "icon", "id", "label"]);
  });
});
