import { NextResponse } from "next/server";
import { z } from "zod";

// Contracts for the merge and duplicate SQL in docs/migrations/2026-10-25_b_crm_merge_dedupe.sql.

export const MERGE_KINDS = ["business", "contact", "lead"] as const;
export type MergeKind = (typeof MERGE_KINDS)[number];

/** Fields the user can pick a side for. Must match crm.merge_fields() (enforced by merge.sql-sync.test.ts). */
export const MERGE_FIELDS = {
  business: ["name", "website", "phone", "email", "address", "industry", "size", "source", "notes"],
  contact: ["first_name", "last_name", "email", "phone", "title", "role", "linkedin_url", "is_primary", "business_id", "notes"],
  lead: [
    "stage", "estimated_value", "contact_id", "assigned_agent", "close_date", "lost_reason", "source", "entry_stage",
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "referrer", "landing_path", "quiz_url",
  ],
} as const satisfies Record<MergeKind, readonly string[]>;

/** "keep" = surviving record's value, "merge" = merged record's value, "both" = notes joined (notes only). */
export type FieldChoice = "keep" | "merge" | "both";
export type MergeFields = Partial<Record<string, FieldChoice>>;

export const MERGE_RPC: Record<MergeKind, string> = {
  business: "merge_businesses",
  contact: "merge_contacts",
  lead: "merge_leads",
};

const uuid = z.string().uuid();
const kind = z.enum(MERGE_KINDS);

export const MergeBody = z.object({
  kind,
  keep_id: uuid,
  merge_id: uuid,
  fields: z.record(z.string(), z.enum(["keep", "merge", "both"])).optional(),
}).superRefine((v, ctx) => {
  if (v.keep_id === v.merge_id) ctx.addIssue({ code: "custom", message: "keep_id and merge_id must differ", path: ["merge_id"] });
  const allowed: readonly string[] = MERGE_FIELDS[v.kind];
  for (const [f, c] of Object.entries(v.fields ?? {})) {
    if (!allowed.includes(f)) ctx.addIssue({ code: "custom", message: `unknown field ${f}`, path: ["fields", f] });
    else if (c === "both" && f !== "notes") ctx.addIssue({ code: "custom", message: `"both" is only for notes`, path: ["fields", f] });
  }
});
export type MergeRequest = z.infer<typeof MergeBody>;

export const PreviewQuery = z.object({ kind, keep_id: uuid, merge_id: uuid });

export const DismissBody = z.object({
  kind,
  a_id: uuid,
  b_id: uuid,
  note: z.string().trim().max(500).optional(),
}).refine((v) => v.a_id !== v.b_id, { message: "a_id and b_id must differ", path: ["b_id"] });

export const RedirectQuery = z.object({ kind, id: uuid });

/** {"crm.leads.business_id": 3, ...}: rows that moved (or would move) per referencing column. */
export type MoveCounts = Record<string, number>;

/** crm.merge_* result. */
export interface MergeResult {
  kind: MergeKind;
  kept_id: string;
  merged_id: string;
  moved: MoveCounts;
  /** Scope documents whose deal/client link was dropped to avoid a unique collision (they stay on the organization). */
  unlinked?: Record<string, number>;
  /** Contact merges: duplicate email links/activities folded into the kept person. */
  combined?: Record<string, number>;
  /** The "Merged from …" system activity (null for an organization with no deals, people or client). */
  note_activity_id: string | null;
}

export interface MergePreviewField {
  field: string;
  keep: unknown;
  merge: unknown;
  /** What the merge does when the request leaves this field out. */
  default: "keep" | "merge";
  /** True when only "keep" is accepted (an ebook/quiz deal's attribution). */
  locked: boolean;
}

/** crm.merge_preview result. */
export interface MergePreview {
  kind: MergeKind;
  keep: Record<string, unknown>;
  merge: Record<string, unknown>;
  fields: MergePreviewField[];
  moves: MoveCounts;
  collisions: Record<string, number>;
  warnings: string[];
}

export type DuplicateReason =
  | "same_domain" | "similar_name"            // business
  | "same_email" | "same_name"                // contact
  | "two_open_deals" | "open_deal_at_client"; // lead

/** One row of crm.duplicate_candidates(); keep_id/merge_id is the suggested direction. */
export interface DuplicateCandidate {
  kind: MergeKind;
  keep_id: string;
  merge_id: string;
  keep_label: string;
  merge_label: string;
  reasons: DuplicateReason[];
  /** Per reason, e.g. {"same_domain": {"domain": "x.org"}, "similar_name": {"similarity": 0.71}}. */
  detail: Record<string, Record<string, unknown>>;
  score: number;
  dismissed: boolean;
}

/** Where a record of each kind lives in the dashboard. */
export function recordHref(kind: MergeKind, id: string): string {
  switch (kind) {
    case "business": return `/crm/organizations/${id}`;
    case "contact": return `/crm/people/${id}`;
    case "lead": return `/crm/leads/${id}`;
  }
}

/** Duplicates touching one record (for the banner on a record page). */
export function candidatesFor(rows: DuplicateCandidate[], id: string): DuplicateCandidate[] {
  return rows.filter((r) => r.keep_id === id || r.merge_id === id);
}

// SQLSTATEs raised by the merge functions.
const ERRORS: Record<string, { status: number; message: string }> = {
  MG001: { status: 404, message: "Record not found" },
  MG002: { status: 400, message: "Pick two different records" },
  MG003: { status: 409, message: "A record in Trash can't be merged; restore it first" },
  MG004: { status: 409, message: "These deals belong to different organizations; merge the organizations first" },
  MG005: { status: 400, message: "Invalid field choice" },
  MG006: { status: 400, message: "Unknown record kind" },
  MG007: { status: 409, message: "Something still points at the merged record; nothing was changed" },
};

/** Map a Postgres/PostgREST error to a response. MG005 keeps the database message (it names the field). */
export function mergeErrorResponse(error: { code?: string; message?: string }) {
  const m = error.code ? ERRORS[error.code] : undefined;
  if (m) {
    const message = error.code === "MG005" && error.message ? error.message.replace(/^merge: /, "") : m.message;
    return NextResponse.json({ error: message, code: error.code }, { status: m.status });
  }
  console.error("merge route error", error);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
