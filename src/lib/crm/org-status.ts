// Organization relationship status. Mirrors crm.org_status (docs/migrations/2026-10-25_e_organizations.sql);
// keep the two in step.
import type { ClientServiceStatus } from "@/types";

export const ORG_STATUSES = ["prospect", "client", "past_client", "partner"] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];
export type OrgStatusFilter = OrgStatus | "all";

export const ORG_STATUS_META: Record<OrgStatus, { label: string; plural: string; badge: string }> = {
  prospect:    { label: "Prospect",    plural: "Prospects",    badge: "badge-neutral" },
  client:      { label: "Client",      plural: "Clients",      badge: "badge-success" },
  past_client: { label: "Past client", plural: "Past clients", badge: "badge-warning" },
  partner:     { label: "Partner",     plural: "Partners",     badge: "badge-orange" },
};

export function isOrgStatus(v: unknown): v is OrgStatus {
  return typeof v === "string" && (ORG_STATUSES as readonly string[]).includes(v);
}

/** `?status=` on /crm/organizations. Accepts "past" as a short form of past_client; anything else is "all". */
export function parseOrgStatusFilter(raw: string | null | undefined): OrgStatusFilter {
  if (raw === "past") return "past_client";
  return isOrgStatus(raw) ? raw : "all";
}

export type ClientRecordState = {
  billing_status: string | null;
  contract_end: string | null;
  services: { status: ClientServiceStatus | string }[];
};

const LIVE_SERVICE = new Set(["pending_activation", "active", "paused"]);

/**
 * A client record is live when billing is active or paused, a service is pending, active or paused, or it
 * has no services yet and its contract hasn't ended (a new client still being set up: billing_status
 * defaults to 'cancelled' until a service activates). `today` is YYYY-MM-DD.
 */
export function isLiveClient(c: ClientRecordState, today: string): boolean {
  if (c.billing_status === "active" || c.billing_status === "paused") return true;
  if (c.services.some((s) => LIVE_SERVICE.has(s.status))) return true;
  return c.services.length === 0 && (!c.contract_end || c.contract_end >= today);
}

/** The status derived from client records alone: client, past_client or prospect. */
export function deriveOrgStatus(clients: ClientRecordState[], today: string): Exclude<OrgStatus, "partner"> {
  if (clients.length === 0) return "prospect";
  return clients.some((c) => isLiveClient(c, today)) ? "client" : "past_client";
}

/** The status shown: the manual override (crm.businesses.relationship) wins over the derived one. */
export function orgStatus(override: string | null | undefined, clients: ClientRecordState[], today: string): OrgStatus {
  return isOrgStatus(override) ? override : deriveOrgStatus(clients, today);
}

export function countByStatus(rows: { status: OrgStatus }[]): Record<OrgStatusFilter, number> {
  const out: Record<OrgStatusFilter, number> = { all: rows.length, prospect: 0, client: 0, past_client: 0, partner: 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}

/** YYYY-MM-DD in New York, which is what "has the contract ended" means for Rosably. */
export function todayNY(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
