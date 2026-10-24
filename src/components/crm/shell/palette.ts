// ⌘K palette state, kept free of React so it can be unit-tested. The palette shows one flat,
// keyboard-navigable list made of the search results (grouped) followed by the matching actions.
import type { SearchResults } from "@/lib/crm/search";

export type NewKind = "lead" | "organization" | "person" | "discovery" | "room" | "hours";

/** The + New menu, in order. The palette offers the same actions. */
export const NEW_ITEMS: { kind: NewKind; label: string; hint: string }[] = [
  { kind: "lead",         label: "Lead",                    hint: "A new deal in the pipeline" },
  { kind: "organization", label: "Organization",            hint: "A business record" },
  { kind: "person",       label: "Person",                  hint: "A contact at an organization" },
  { kind: "discovery",    label: "Discovery questionnaire", hint: "Draft one for a lead or a new organization" },
  { kind: "room",         label: "Engagement room",         hint: "Share work with a prospect or client" },
  { kind: "hours",        label: "Log hours",               hint: "Time on a client's T&M service" },
];

export const GO_TO: { label: string; href: string }[] = [
  { label: "Today",         href: "/crm/today" },
  { label: "Pipeline",      href: "/crm" },
  { label: "Organizations", href: "/crm/organizations" },
  { label: "People",        href: "/crm/contacts" },
  { label: "Inbox",         href: "/crm/inbox" },
  { label: "CRM settings",  href: "/crm/settings" },
];

export type PaletteGroup = "Organizations" | "People" | "Deals" | "Create" | "Go to";
export type PaletteItem =
  | { key: string; group: PaletteGroup; label: string; detail: string | null; href: string }
  | { key: string; group: PaletteGroup; label: string; detail: string | null; create: NewKind };

const matches = (label: string, q: string) => !q || label.toLowerCase().includes(q);

/** Results first (organizations, people, deals), then the create and go-to actions that match. */
export function buildPaletteItems(results: SearchResults, query: string): PaletteItem[] {
  const q = query.trim().toLowerCase();
  const items: PaletteItem[] = [];
  for (const [group, hits] of [["Organizations", results.organizations], ["People", results.people], ["Deals", results.deals]] as const) {
    for (const h of hits) items.push({ key: `${group}:${h.id}`, group, label: h.label, detail: h.detail, href: h.href });
  }
  for (const n of NEW_ITEMS) {
    const label = n.kind === "hours" ? n.label : `New ${n.label.toLowerCase()}`;
    if (matches(label, q)) items.push({ key: `new:${n.kind}`, group: "Create", label, detail: null, create: n.kind });
  }
  for (const g of GO_TO) {
    if (matches(g.label, q)) items.push({ key: `go:${g.href}`, group: "Go to", label: g.label, detail: null, href: g.href });
  }
  return items;
}

export type PaletteState = { query: string; active: number };
export type PaletteAction =
  | { type: "query"; query: string }
  | { type: "move"; delta: number; count: number }
  | { type: "set"; index: number }
  | { type: "reset" };

export const INITIAL_PALETTE: PaletteState = { query: "", active: 0 };

export function paletteReducer(state: PaletteState, action: PaletteAction): PaletteState {
  switch (action.type) {
    case "query":
      return { query: action.query, active: 0 };
    case "move":
      if (action.count <= 0) return { ...state, active: 0 };
      return { ...state, active: (((state.active + action.delta) % action.count) + action.count) % action.count };
    case "set":
      return { ...state, active: action.index };
    case "reset":
      return INITIAL_PALETTE;
  }
}
