// Validation for the lead next-step fields (crm.leads.next_step, next_step_due).

export const NEXT_STEP_MAX = 500;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type NextStepPatch = { next_step?: string | null; next_step_due?: string | null };

/**
 * Picks next_step / next_step_due out of a request body. Absent keys stay absent; "" and null clear
 * the field. Returns an error message for a bad value.
 */
export function parseNextStep(body: Record<string, unknown>): { ok: true; patch: NextStepPatch } | { ok: false; error: string } {
  const patch: NextStepPatch = {};
  if ("next_step" in body) {
    const v = body.next_step;
    if (v === null || v === undefined) patch.next_step = null;
    else if (typeof v !== "string") return { ok: false, error: "next_step must be a string" };
    else {
      const t = v.trim();
      if (t.length > NEXT_STEP_MAX) return { ok: false, error: `next_step is limited to ${NEXT_STEP_MAX} characters` };
      patch.next_step = t || null;
    }
  }
  if ("next_step_due" in body) {
    const v = body.next_step_due;
    if (v === null || v === undefined || v === "") patch.next_step_due = null;
    else if (typeof v !== "string" || !ISO_DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))
      || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) {
      return { ok: false, error: "next_step_due must be a YYYY-MM-DD date" };
    } else patch.next_step_due = v;
  }
  return { ok: true, patch };
}
