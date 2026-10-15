// No imports: safe to use from client components.
export const BUILD_CLOSED_STATUSES = ["done", "cancelled", "rejected", "deferred"] as const;
export const BUILD_STALL_MS = 10 * 60 * 1000;
export const BUILD_LOG_LIMIT = 5;

export interface BuildLog { at: string; author: string; type: string; message: string }
export interface Build {
  deliverable_id: string; work_item_id: string; ref: number | null; status: string; agent: string | null;
  requested_at: string; last_activity_at: string; stalled: boolean; logs: BuildLog[];
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const HEADER_RE = new RegExp(`^ROOMS_PROTOTYPE_REQUEST v1\\ndeliverable_id: (${UUID})(?:\\n|$)`);

// The id is only read from the line right under the header, never from the quoted brief text further down.
export function deliverableIdFromBrief(description: unknown): string | null {
  if (typeof description !== "string") return null;
  const m = HEADER_RE.exec(description);
  return m ? m[1] : null;
}

export function isStalled(lastActivityIso: string, nowMs: number): boolean {
  const t = Date.parse(lastActivityIso);
  return Number.isFinite(t) && nowMs - t > BUILD_STALL_MS;
}

export function minutesSince(iso: string, nowMs: number): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 60_000)) : 0;
}
