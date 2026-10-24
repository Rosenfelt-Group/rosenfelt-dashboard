// Soft delete and Trash: shared types, labels and input validation (no server imports, so UI code
// can use it too). The SQL lives in docs/migrations/2026-10-25_a_crm_soft_delete.sql.

export const TRASH_RETENTION_DAYS = 30;

export const TRASH_KINDS = [
  "business", "contact", "lead", "client", "discovery_invite", "scope_document", "engagement", "business_research", "research_brief",
] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];

/** What the UI calls each kind (singular). */
export const KIND_LABELS: Record<TrashKind, string> = {
  business: "Organization",
  contact: "Person",
  lead: "Deal",
  client: "Client record",
  discovery_invite: "Discovery questionnaire",
  scope_document: "Scope",
  engagement: "Room",
  business_research: "Research note",
  research_brief: "Library brief",
};

/** Keys of DeletePreview.goes / .stays, with a label for a count of n. */
export const COUNT_LABELS: Record<string, (n: number) => string> = {
  contacts: (n) => (n === 1 ? "1 person" : `${n} people`),
  leads: (n) => plural(n, "deal"),
  clients: (n) => plural(n, "client record"),
  discovery_invites: (n) => plural(n, "discovery questionnaire"),
  scope_documents: (n) => plural(n, "scope document"),
  engagements: (n) => plural(n, "room"),
  business_research: (n) => plural(n, "research note"),
  lead_activities: (n) => plural(n, "timeline entry", "timeline entries"),
  client_services: (n) => plural(n, "service"),
  email_links: (n) => plural(n, "linked email"),
  engagement_contacts: (n) => plural(n, "room member"),
  discovery_responses: (n) => plural(n, "questionnaire answer set"),
  discovery_briefs: (n) => plural(n, "discovery brief"),
  scope_versions: (n) => plural(n, "scope version"),
  deliverables: (n) => plural(n, "deliverable"),
  access_links: (n) => plural(n, "active access link"),
};

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Labels for the non-zero counts, in a stable order. */
export function countLines(counts: Record<string, number>): string[] {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => (COUNT_LABELS[k] ? COUNT_LABELS[k](n) : `${n} ${k.replace(/_/g, " ")}`));
}

export type LiveStripeService = {
  id: string; client_id: string; service: string | null; status: string;
  stripe_subscription_id: string; stripe_subscription_status: string | null;
};

/** crm.delete_preview */
export type DeletePreview = {
  kind: TrashKind;
  id: string;
  name: string | null;
  /** Set when the record is already in Trash. */
  deleted_at: string | null;
  /** Set when crm.soft_delete would refuse (TR001): cancel these services first. */
  blocked: { reason: "stripe_services"; services: LiveStripeService[] } | null;
  goes: Record<string, number>;
  stays: Record<string, number>;
};

/** crm.soft_delete */
export type SoftDeleteResult = {
  kind: TrashKind; id: string; name: string | null; deleted_at: string; deleted_by: string | null;
  cascaded: Record<string, number>;
};

/** crm.restore_deleted */
export type RestoreResult = { kind: TrashKind; id: string; name: string | null; restored: Record<string, number> };

/** crm.purge_deleted */
export type PurgeResult = { kind: TrashKind; id: string; name: string | null; purged: true };

/** A row of crm.trash_items(): top-level deleted items, newest first. */
export type TrashItem = {
  kind: TrashKind;
  id: string;
  name: string | null;
  /** The organization the item belongs to (null for organizations and library briefs). */
  business_id: string | null;
  business_name: string | null;
  deleted_at: string;
  deleted_by: string | null;
  purge_at: string;
  days_left: number;
  /** Rows deleted together with it, restored with it. */
  group_count: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTrashKind(v: unknown): v is TrashKind {
  return typeof v === "string" && (TRASH_KINDS as readonly string[]).includes(v);
}

export type TrashTarget = { kind: TrashKind; id: string };

/** Validate {kind, id} from a body, query string or route params. */
export function parseTrashTarget(input: { kind?: unknown; id?: unknown } | null | undefined):
  { ok: true; value: TrashTarget } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "kind and id are required" };
  if (!isTrashKind(input.kind)) return { ok: false, error: `kind must be one of ${TRASH_KINDS.join(", ")}` };
  if (typeof input.id !== "string" || !UUID.test(input.id)) return { ok: false, error: "id must be a uuid" };
  return { ok: true, value: { kind: input.kind, id: input.id.toLowerCase() } };
}

/** SQLSTATEs raised by the Trash functions, mapped to HTTP. */
export const TRASH_ERRORS: Record<string, { status: number; message: string }> = {
  TR001: { status: 409, message: "It has services billing through Stripe. Cancel them first." },
  TR002: { status: 404, message: "Not found" },
  TR003: { status: 409, message: "Already in Trash, or not in Trash" },
  TR004: { status: 400, message: "Unknown kind" },
  TR005: { status: 409, message: "Its parent is in Trash. Restore the parent first." },
  TR006: { status: 409, message: "Live records still point at it, so it can't be removed for good yet." },
};

/**
 * {status, body} for a Postgres/PostgREST error from a Trash function; unknown errors are a generic 500.
 * `override` replaces a code's message (TR003 means "already in Trash" on delete, "not in Trash" on restore).
 */
export function trashError(error: { code?: string; message?: string; details?: string | null }, override?: Partial<Record<string, string>>):
  { status: number; body: { error: string; code?: string; services?: LiveStripeService[] } } {
  const code = error.code;
  const m = code ? TRASH_ERRORS[code] : undefined;
  if (!code || !m) return { status: 500, body: { error: "Internal error" } };
  let services: LiveStripeService[] | undefined;
  if (code === "TR001" && error.details) {
    try { services = JSON.parse(error.details) as LiveStripeService[]; } catch { services = undefined; }
  }
  return { status: m.status, body: { error: override?.[code] ?? m.message, code, ...(services ? { services } : {}) } };
}
