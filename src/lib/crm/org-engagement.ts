// Per-deal engagement progress on the organization page: Discovery → Scope → Room → Delivery.
import type { CRMStage } from "@/types";

export const JOURNEY_STEPS = [
  { id: "discovery", label: "Discovery", hint: "Questionnaire & brief" },
  { id: "scope", label: "Scope", hint: "Sections & versions" },
  { id: "room", label: "Room", hint: "Share with the client" },
  { id: "delivery", label: "Delivery", hint: "Services & time" },
] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number]["id"];

export type InviteSummary = {
  id: string; project_title: string; status: string; sent_at: string | null; opened_at: string | null;
  submitted_at: string | null; expires_at: string; created_at: string; brief_status: string | null;
  contact: { id: string; first_name: string; last_name: string | null; email: string | null } | null;
};
export type ScopeSummary = {
  id: string; title: string; lead_id: string | null; client_id: string | null; engagement_type: string | null;
  delivery_model: string | null; current_version_no: number | null; current_decided_at: string | null;
  proposals: { id: string; version_no: number; created_at: string; created_by: string | null; change_note: string | null }[];
};
export type RoomSummary = {
  id: string; title: string; relationship: string; status: string; lead_id: string | null; created_at: string;
  shared_versions: number; active_links: number; last_opened_at: string | null;
};
export type DealSummary = {
  id: string; stage: CRMStage; estimated_value: number | null; close_date: string | null; source: string | null;
  created_at: string; updated_at: string; converted_at: string | null; lost_reason: string | null;
  /** crm.leads next step (2026-10-25_d_leads_next_step.sql). */
  next_step: string | null; next_step_due: string | null;
  contact: { id: string; first_name: string; last_name: string | null; email: string | null } | null;
  discovery: InviteSummary[]; scope: ScopeSummary | null; rooms: RoomSummary[]; client_id: string | null;
};

/** Index into JOURNEY_STEPS of the furthest step the deal has reached, or -1 when nothing has started. */
export function dealJourney(d: Pick<DealSummary, "discovery" | "scope" | "rooms" | "client_id">): -1 | 0 | 1 | 2 | 3 {
  if (d.client_id) return 3;
  if (d.rooms.some((r) => r.shared_versions > 0 || r.active_links > 0)) return 2;
  if (d.scope) return 1;
  if (d.discovery.length > 0 || d.rooms.length > 0) return 0;
  return -1;
}

export const OPEN_STAGES = new Set<CRMStage>(["quiz_started", "quiz_completed", "snapshot_viewed", "new", "qualification", "engaged", "call_demo_scheduled", "proposal"]);
export const isOpenDeal = (d: { stage: CRMStage }) => OPEN_STAGES.has(d.stage);

/**
 * Rooms and scopes may be linked to a deal or only to the organization. Anything not linked to a deal
 * goes to the only deal when there is exactly one; otherwise it is listed separately.
 */
export function assignToDeals<T extends { lead_id: string | null }>(rows: T[], dealIds: string[]): { byDeal: Map<string, T[]>; unassigned: T[] } {
  const byDeal = new Map<string, T[]>(dealIds.map((id) => [id, []]));
  const unassigned: T[] = [];
  for (const r of rows) {
    const target = r.lead_id && byDeal.has(r.lead_id) ? r.lead_id : !r.lead_id && dealIds.length === 1 ? dealIds[0] : null;
    if (target) byDeal.get(target)!.push(r);
    else unassigned.push(r);
  }
  return { byDeal, unassigned };
}

/** The deal the Engagement tab opens on: the newest open deal, else the newest deal. */
export function defaultDealId(deals: Pick<DealSummary, "id" | "stage" | "created_at">[]): string | null {
  const newest = [...deals].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (newest.find(isOpenDeal) ?? newest[0])?.id ?? null;
}
