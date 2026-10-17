export const BUSINESS_TABS = [
  { id: "contacts",  label: "Contacts" },
  { id: "research",  label: "Research" },
  { id: "rooms",     label: "Rooms" },
  { id: "discovery", label: "Discovery" },
  { id: "leads",     label: "Leads" },
  { id: "clients",   label: "Clients" },
] as const;

export type BusinessTab = (typeof BUSINESS_TABS)[number]["id"];

/** Reads the ?tab= value; anything unrecognised falls back to the first tab. */
export function parseBusinessTab(value: string | null | undefined): BusinessTab {
  return BUSINESS_TABS.find(t => t.id === value)?.id ?? "contacts";
}
