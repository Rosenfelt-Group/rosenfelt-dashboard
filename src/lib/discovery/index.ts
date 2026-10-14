import { DiscoveryProjectType, DiscoveryStatus, DiscoveryFieldDef } from "@/types";

// Public site that hosts the questionnaire (WordPress mu-plugin rosably-discovery.php).
export const DISCOVERY_SITE = (process.env.NEXT_PUBLIC_DISCOVERY_SITE_URL ?? "https://rosably.com").replace(/\/$/, "");

export function discoveryLink(token: string) {
  return `${DISCOVERY_SITE}/discovery/?t=${token}`;
}

export const PROJECT_TYPES: { value: DiscoveryProjectType; label: string }[] = [
  { value: "content_social", label: "Content & social media" },
  { value: "operations",     label: "Operations & internal workflow" },
  { value: "fundraising",    label: "Fundraising, donors & CRM" },
  { value: "data_reporting", label: "Data, reporting & impact" },
  { value: "other",          label: "Something else" },
];

export const STATUS_META: Record<DiscoveryStatus, { label: string; color: string }> = {
  sent:        { label: "Sent",        color: "bg-gray-100 text-gray-600" },
  opened:      { label: "Opened",      color: "bg-blue-50 text-blue-700" },
  in_progress: { label: "In progress", color: "bg-amber-50 text-amber-700" },
  submitted:   { label: "Submitted",   color: "bg-green-50 text-green-700" },
  archived:    { label: "Archived",    color: "bg-gray-100 text-gray-400" },
};

export function isEmptyAnswer(v: unknown): boolean {
  if (Array.isArray(v)) {
    return v.every(item =>
      item && typeof item === "object"
        ? Object.values(item as Record<string, unknown>).every(c => !String(c ?? "").trim())
        : !String(item ?? "").trim(),
    );
  }
  return v === null || v === undefined || String(v).trim() === "";
}

// Mirrors the form's isVisible() so conditional questions hidden from the
// respondent are hidden here too.
export function isFieldVisible(field: DiscoveryFieldDef, answers: Record<string, unknown>): boolean {
  const c = field.showIf;
  if (!c) return true;
  const val = answers[c.field];
  if (isEmptyAnswer(val)) return false;
  const vals = (Array.isArray(val) ? val : [val]).map(String);
  if (c.in) return vals.some(v => c.in!.includes(v));
  if (c.notIn) return vals.some(v => !c.notIn!.includes(v));
  return true;
}
