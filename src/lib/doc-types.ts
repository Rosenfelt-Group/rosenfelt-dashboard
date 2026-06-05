// Friendly display labels for the controlled doc_type enum (doc_registry).
// Snake_case enum values → human labels. Single source for all doc UIs.
export const DOC_TYPE_LABELS: Record<string, string> = {
  architecture: "Architecture",
  tech_spec: "Tech Spec",
  sop: "SOP",
  instruction: "Instruction",
  business_plan: "Business Plan",
  marketing: "Marketing",
  client_deliverable: "Client Deliverable",
  session_log: "Session Log",
  reference: "Reference",
};

export function docTypeLabel(t?: string | null): string {
  if (!t) return "Uncategorized";
  return DOC_TYPE_LABELS[t] ?? t;
}
