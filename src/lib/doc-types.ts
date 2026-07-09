// Friendly display labels + types for the controlled doc_registry taxonomy.
// Single source for all doc UIs.

import { z } from "zod";

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

// ── Canonical enum arrays (for iteration / dropdown building) ────────────────

export const DOC_TYPES: DocType[] = [
  "governance", "strategy", "marketing", "technical", "sop", "rules", "prompts", "planning", "logs",
];

export const DOC_AUDIENCES: DocAudience[] = ["internal", "public", "client"];

export const DOC_STATUSES: DocStatus[] = ["draft", "active", "archived", "superseded"];

// ── Zod schemas — single source of truth for server-side write validation ────

export const DocTypeSchema = z.enum(DOC_TYPES as [DocType, ...DocType[]]);
export const DocAudienceSchema = z.enum(DOC_AUDIENCES as [DocAudience, ...DocAudience[]]);
export const DocStatusSchema = z.enum(DOC_STATUSES as [DocStatus, ...DocStatus[]]);

export const DocMetadataPatchSchema = z
  .object({
    doc_type: DocTypeSchema.optional(),
    status: DocStatusSchema.optional(),
    audience: DocAudienceSchema.optional(),
    client_id: z.string().uuid().nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, { message: "Patch must include at least one field" });

export const DocBulkPatchSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  patch: z
    .object({
      doc_type: DocTypeSchema.optional(),
      status: DocStatusSchema.optional(),
      audience: DocAudienceSchema.optional(),
      client_id: z.string().uuid().nullable().optional(),
    })
    .refine((obj) => Object.keys(obj).length > 0, { message: "Patch must include at least one field" }),
});

// ── Status badge colors ───────────────────────────────────────────────────────

export const DOC_STATUS_COLORS: Record<DocStatus, string> = {
  draft: "bg-amber-50 text-amber-700 border-amber-200",
  active: "bg-green-50 text-green-700 border-green-200",
  archived: "bg-gray-100 text-gray-600 border-gray-200",
  superseded: "bg-red-50 text-red-700 border-red-200",
};

// ── Index-health computation (single source of truth) ────────────────────────
// Stale = active/draft row where updated_at > last_indexed_at.
// Not indexed = chunk_count IS NULL on a non-archived, non-binary (no storage_path) row.

export type DocHealth = "indexed" | "stale" | "not_indexed" | "n/a";

export const DOC_HEALTH_LABELS: Record<DocHealth, string> = {
  indexed: "Indexed",
  stale: "Stale",
  not_indexed: "Not indexed",
  "n/a": "N/A",
};

export function computeHealth(doc: {
  status?: string | null;
  storage_path?: string | null;
  chunk_count?: number | null;
  last_indexed_at?: string | null;
  updated_at?: string | null;
}): DocHealth {
  const isBinary = !!doc.storage_path;
  if (isBinary) return "n/a";

  const isDraftOrActive = doc.status === "active" || doc.status === "draft";
  if (
    isDraftOrActive &&
    doc.last_indexed_at &&
    doc.updated_at &&
    new Date(doc.updated_at).getTime() > new Date(doc.last_indexed_at).getTime()
  ) {
    return "stale";
  }

  if (doc.status !== "archived" && doc.chunk_count == null) {
    return "not_indexed";
  }

  return "indexed";
}
