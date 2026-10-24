import { describe, expect, it } from "vitest";
import { EMPTY_RESULTS } from "@/lib/crm/search";
import { buildPaletteItems, GO_TO, INITIAL_PALETTE, NEW_ITEMS, paletteReducer } from "./palette";

const RESULTS = {
  organizations: [{ id: "b1", label: "Harbor Light", detail: "harborlight.org", href: "/crm/organizations/b1" }],
  people: [{ id: "c1", label: "Dana Whitfield", detail: "Harbor Light", href: "/crm/people/c1" }],
  deals: [{ id: "l1", label: "Harbor Light — Dana Whitfield", detail: "Proposal", href: "/crm/leads/l1" }],
};

describe("buildPaletteItems", () => {
  it("with no query lists every create and go-to action", () => {
    const items = buildPaletteItems(EMPTY_RESULTS, "");
    expect(items.filter(i => i.group === "Create")).toHaveLength(NEW_ITEMS.length);
    expect(items.filter(i => i.group === "Go to")).toHaveLength(GO_TO.length);
  });

  it("puts results first, grouped, then matching actions", () => {
    const items = buildPaletteItems(RESULTS, "harbor");
    expect(items.map(i => i.group)).toEqual(["Organizations", "People", "Deals"]);
    expect(items.map(i => "href" in i && i.href)).toEqual(["/crm/organizations/b1", "/crm/people/c1", "/crm/leads/l1"]);
  });

  it("filters actions by the query", () => {
    const items = buildPaletteItems(EMPTY_RESULTS, "new");
    expect(items.every(i => i.group === "Create")).toBe(true);
    expect(items.map(i => "create" in i && i.create)).toEqual(["lead", "organization", "person", "discovery", "room"]);
    expect(buildPaletteItems(EMPTY_RESULTS, "log").map(i => i.label)).toEqual(["Log hours"]);
    expect(buildPaletteItems(EMPTY_RESULTS, "inbox").map(i => "href" in i && i.href)).toEqual(["/crm/inbox"]);
  });

  it("keys are unique", () => {
    const keys = buildPaletteItems(RESULTS, "").map(i => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("paletteReducer", () => {
  it("a new query resets the selection", () => {
    expect(paletteReducer({ query: "a", active: 3 }, { type: "query", query: "ab" })).toEqual({ query: "ab", active: 0 });
  });

  it("moves down and up with wrap-around", () => {
    let s = INITIAL_PALETTE;
    s = paletteReducer(s, { type: "move", delta: 1, count: 3 });
    expect(s.active).toBe(1);
    s = paletteReducer(s, { type: "move", delta: 1, count: 3 });
    s = paletteReducer(s, { type: "move", delta: 1, count: 3 });
    expect(s.active).toBe(0);
    s = paletteReducer(s, { type: "move", delta: -1, count: 3 });
    expect(s.active).toBe(2);
  });

  it("stays at 0 when the list is empty", () => {
    expect(paletteReducer({ query: "zz", active: 2 }, { type: "move", delta: 1, count: 0 }).active).toBe(0);
  });

  it("set and reset", () => {
    expect(paletteReducer(INITIAL_PALETTE, { type: "set", index: 4 }).active).toBe(4);
    expect(paletteReducer({ query: "x", active: 4 }, { type: "reset" })).toEqual(INITIAL_PALETTE);
  });
});
