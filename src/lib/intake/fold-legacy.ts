import type { IntakeInput } from "./schema";

export interface LegacyProspect {
  id: string;
  org_name: string | null;
  source: string | null;
  notes: string | null;
  discovery_call_booked_at: string | null;
}

export interface LegacyAssessmentLead {
  id: string;
  name: string;
  email: string;
  org: string | null;
  source: string | null;
  org_type?: string | null;
  created_at?: string | null;
}

export type FoldDecision =
  | { action: "intake"; table: string; id: string; input: IntakeInput }
  | { action: "skip"; table: string; id: string; reason: "test" | "no email"; email: string | null };

const TEST_DOMAINS = ["example.com", "test.com", "sfsfsfs.com"];
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export function isTestEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  return TEST_DOMAINS.some((d) => e.endsWith(d));
}

/** Pull the first email address out of free text (prospects have no email column). */
export function emailFromNotes(notes: string | null | undefined): string | null {
  const m = (notes ?? "").match(EMAIL_RE);
  return m ? m[0] : null;
}

export function classifyProspect(row: LegacyProspect): FoldDecision {
  const email = emailFromNotes(row.notes);
  if (!email) return { action: "skip", table: "prospects", id: row.id, reason: "no email", email: null };
  if (isTestEmail(email)) return { action: "skip", table: "prospects", id: row.id, reason: "test", email };
  const booked = row.discovery_call_booked_at ? ` @ ${row.discovery_call_booked_at}` : "";
  return {
    action: "intake", table: "prospects", id: row.id,
    input: {
      channel: "calendly",
      email,
      ...(row.org_name ? { name: row.org_name.slice(0, 2000) } : {}),
      stage: "call_demo_scheduled",
      summary: `Legacy prospect: discovery call${booked}`,
      payload: { legacy_table: "prospects", legacy_id: row.id },
    },
  };
}

export function classifyAssessmentLead(row: LegacyAssessmentLead): FoldDecision {
  const email = (row.email ?? "").trim();
  if (!email) return { action: "skip", table: "assessment_leads", id: row.id, reason: "no email", email: null };
  if (isTestEmail(email)) return { action: "skip", table: "assessment_leads", id: row.id, reason: "test", email };
  return {
    action: "intake", table: "assessment_leads", id: row.id,
    input: {
      channel: row.source === "ebook" ? "ebook" : "quiz",
      email,
      ...(row.name ? { name: row.name } : {}),
      ...(row.org ? { org: row.org } : {}),
      summary: "Legacy assessment lead",
      payload: { legacy_table: "assessment_leads", legacy_id: row.id },
    },
  };
}

export function formatDecision(d: FoldDecision): string {
  if (d.action === "skip") {
    return `${d.table}/${d.id}  skip (${d.reason === "test" ? "test" : "no email"})${d.email ? `  ${d.email}` : ""}`;
  }
  return `${d.table}/${d.id}  intake ${JSON.stringify(d.input)}`;
}
