// Friendly display labels + types for the controlled doc_registry taxonomy.
// Single source for all doc UIs.

export type DocType =
  | "governance"
  | "strategy"
  | "marketing"
  | "technical"
  | "sop"
  | "rules"
  | "prompts"
  | "planning"
  | "logs";

export type DocAudience = "internal" | "public" | "client";

export type DocStatus = "draft" | "active" | "archived" | "superseded";

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  governance: "Governance",
  strategy: "Strategy",
  marketing: "Marketing",
  technical: "Technical",
  sop: "SOP",
  rules: "Rules",
  prompts: "Prompts",
  planning: "Planning",
  logs: "Logs",
};

export const DOC_AUDIENCE_LABELS: Record<DocAudience, string> = {
  internal: "Internal",
  public: "Public",
  client: "Client",
};

export const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
  superseded: "Superseded",
};

export function docTypeLabel(t?: string | null): string {
  if (!t) return "Uncategorized";
  return DOC_TYPE_LABELS[t as DocType] ?? t;
}

export function docAudienceLabel(a?: string | null): string {
  if (!a) return "Unknown";
  return DOC_AUDIENCE_LABELS[a as DocAudience] ?? a;
}

export function docStatusLabel(s?: string | null): string {
  if (!s) return "Unknown";
  return DOC_STATUS_LABELS[s as DocStatus] ?? s;
}
