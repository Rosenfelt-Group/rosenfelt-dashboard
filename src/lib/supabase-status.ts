// Supabase's public status feed (status.supabase.com/api/v2/summary.json) has dropped or nulled
// fields before (e.g. `incidents` became null in Oct 2026). Normalise it so the Status tab always
// gets arrays and a status object.
type Obj = Record<string, unknown>;

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function normalizeSupabaseStatus(raw: unknown) {
  const r = (raw && typeof raw === "object" ? raw : {}) as Obj;
  const s = (r.status && typeof r.status === "object" ? r.status : {}) as Obj;
  return {
    status: {
      indicator: typeof s.indicator === "string" ? s.indicator : "unknown",
      description: typeof s.description === "string" ? s.description : "Status unknown",
    },
    components: arr(r.components),
    incidents: arr(r.incidents),
    scheduled_maintenances: arr(r.scheduled_maintenances),
  };
}
