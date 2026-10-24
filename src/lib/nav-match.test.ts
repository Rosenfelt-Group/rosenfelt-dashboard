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

});

describe("CRM sub-pages after the 2026-10-24 refresh", () => {
  const crm = SUB_PAGES.crm;
  const at = (path: string) => activeSubPageHref(crm, path);

  it("lists Today, Pipeline, Organizations, People, Inbox and CRM settings", () => {
    expect(crm.map(p => [p.label, p.href])).toEqual([
      ["Today", "/crm/today"],
      ["Pipeline", "/crm"],
      ["Organizations", "/crm/organizations"],
      ["People", "/crm/contacts"],
      ["Inbox", "/crm/inbox"],
      ["CRM settings", "/crm/settings"],
    ]);
  });

  it("the CRM nav item lands on Today", () => {
    expect(ALL_NAV_ITEMS.find(i => i.id === "crm")?.href).toBe("/crm/today");
  });

  it.each([
    ["/crm/today", "/crm/today"],
    ["/crm", "/crm"],
    ["/crm/leads/abc", "/crm"],
    ["/crm/discovery", "/crm"],
    ["/crm/discovery/abc", "/crm"],
    ["/crm/scope", "/crm"],
    ["/crm/scope/abc", "/crm"],
    ["/crm/organizations", "/crm/organizations"],
    ["/crm/organizations/abc", "/crm/organizations"],
    ["/crm/businesses", "/crm/organizations"],
    ["/crm/businesses/abc", "/crm/organizations"],
    ["/crm/clients", "/crm/organizations"],
    ["/crm/clients/abc", "/crm/organizations"],
    ["/crm/rooms", "/crm/organizations"],
    ["/engagements/abc", "/crm/organizations"],
    ["/crm/contacts", "/crm/contacts"],
    ["/crm/people/abc", "/crm/contacts"],
    ["/crm/inbox", "/crm/inbox"],
    ["/crm/settings", "/crm/settings"],
    ["/crm/admin/services", "/crm/settings"],
    ["/crm/discovery/questions", "/crm/settings"],
    ["/crm/discovery/templates", "/crm/settings"],
    ["/crm/discovery/templates/abc", "/crm/settings"],
  ])("%s highlights %s", (path, href) => {
    expect(at(path)).toBe(href);
    expect(matchingItems(ALL_NAV_ITEMS, path).map(i => i.id)).toEqual(["crm"]);
  });

  it("Discovery, Scope and Rooms are no longer in the nav", () => {
    for (const l of ["Discovery", "Scope", "Rooms", "Businesses", "Clients", "Services"]) {
      expect(crm.map(p => p.label)).not.toContain(l);
    }
  });

  it("Inbox carries the unsorted-count badge", () => {
    expect(crm.find(p => p.href === "/crm/inbox")?.badge).toBe("inbox");
  });
});

describe("redirects for pages moved into CRM settings", async () => {
  const { default: config } = await import("../../next.config");
  const redirects = await config.redirects!();
  const find = (source: string) => redirects.find(r => r.source === source);

  it.each([
    ["/crm/admin/services", "/crm/settings?tab=services"],
    ["/crm/discovery/questions", "/crm/settings?tab=questions"],
    ["/crm/discovery/templates", "/crm/settings?tab=templates"],
  ])("%s → %s", (source, destination) => {
    expect(find(source)).toMatchObject({ destination, permanent: false });
  });

  it("only exact paths redirect, so the template editor still opens", () => {
    for (const r of redirects) expect(r.source).not.toMatch(/[:*(]/);
    expect(find("/crm/discovery/templates/:id")).toBeUndefined();
    expect(routesUnder("/crm/discovery/templates")).toContain("/crm/discovery/templates/__id__");
  });

  it("the moved pages no longer exist as routes", () => {
    for (const p of ["/crm/admin/services", "/crm/discovery/questions", "/crm/discovery/templates"]) {
      expect(pageRoutes()).not.toContain(p);
    }
    expect(pageRoutes()).toContain("/crm/settings");
  });
});

function routesUnder(prefix: string) {
  return pageRoutes().filter(r => r.startsWith(prefix));
}

describe("nav_has_four_primary_areas", () => {
  it("lists CRM, Research, Content, Calendar in order", () => {
    expect(NAV_GROUPS.primary.map(i => i.label)).toEqual(["CRM", "Research", "Content", "Calendar"]);
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
