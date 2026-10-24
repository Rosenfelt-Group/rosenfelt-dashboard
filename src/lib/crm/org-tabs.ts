// Tabs on /crm/organizations/[id] (?tab=). Billing, Time and Work items exist only with a client record.
export const ORG_TABS = [
  { id: "activity", label: "Activity" },
  { id: "engagement", label: "Engagement" },
  { id: "billing", label: "Billing", clientOnly: true },
  { id: "time", label: "Time", clientOnly: true },
  { id: "work", label: "Work items", clientOnly: true },
  { id: "research", label: "Research" },
] as const;
export type OrgTab = (typeof ORG_TABS)[number]["id"];

export function visibleOrgTabs(hasClient: boolean) {
  return ORG_TABS.filter((t) => hasClient || !("clientOnly" in t));
}

/** Unknown tabs, and client tabs on an organization without a client record, fall back to Activity. */
export function parseOrgTab(raw: string | null | undefined, hasClient: boolean): OrgTab {
  return visibleOrgTabs(hasClient).find((t) => t.id === raw)?.id ?? "activity";
}

/** Where the old /crm/businesses/[id]?tab= values land. Contacts are on the left of every tab. */
export function orgTabForBusinessTab(raw: string | null | undefined): OrgTab | null {
  switch (raw) {
    case "research": return "research";
    case "rooms": case "discovery": case "leads": return "engagement";
    case "clients": return "billing";
    default: return null;
  }
}
