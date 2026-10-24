// Pure builder for the CRM Today page: the action queue and the KPI numbers.
// The rows come from src/lib/crm/today.ts (server-only); this file has no server imports so it is
// unit-tested directly and shared with the page for its types.
import { CRMStage } from "@/types";
import { STAGES } from "./stages";
import { dayDiff, dueLabel, isOpenDeal } from "./pipeline";

export type TodayItemType =
  | "next_step" | "scope" | "brief" | "questionnaire" | "inbox" | "duplicate" | "room" | "existing_client";
/** high = overdue, medium = waiting on you, low = for your information. */
export type TodaySeverity = "high" | "medium" | "low";

export type TodayItem = {
  id: string;
  type: TodayItemType;
  title: string;
  subtitle: string;
  link: string;
  severity: TodaySeverity;
  /** When the thing happened (or the due date for next steps); the page shows it relative. */
  at: string | null;
  /** Next-step items only: the lead whose next_step / next_step_due Snooze and Done update. */
  lead_id?: string;
};

export type TodayKpis = {
  open_pipeline: { value: number; count: number };
  active_clients: { count: number; contracted_monthly: number; contracted_project: number };
  hours_this_month: number;
  questionnaires_out: number;
};
export type StageValue = { stage: CRMStage; label: string; count: number; value: number };

export type TodayResponse = {
  generated_at: string;
  today: string;
  items: TodayItem[];
  kpis: TodayKpis;
  by_stage: StageValue[];
  /** False until crm.duplicate_candidates exists (stream A2). */
  duplicates_checked: boolean;
};

type Named = { name: string | null } | null;
const orgName = (b: Named | undefined, fallback = "Unknown organization") => b?.name?.trim() || fallback;

export type TodayRaw = {
  /** YYYY-MM-DD in Brian's time zone. */
  today: string;
  now: string;
  inbox: { count: number; latest: { subject: string | null; contact_email: string | null; timestamp: string | null } | null };
  briefs: { id: string; completed_at: string | null; created_at: string; invite: { id: string; project_title: string | null; business: Named } | null }[];
  proposedScopes: { id: string; version_no: number; created_at: string; created_by: string | null; change_note: string | null; document: { id: string; title: string | null; business: Named } | null }[];
  staleQuestionnaires: { id: string; project_title: string | null; sent_at: string | null; opened_at: string | null; status: string; business: Named }[];
  roomEvents: { engagement_id: string; type: string; created_at: string; engagement: { id: string; title: string | null; business: Named } | null; contact: { name: string | null } | null }[];
  nextSteps: { id: string; next_step: string | null; next_step_due: string | null; business: Named }[];
  existingClientSignups: { id: string; created_at: string; metadata: Record<string, unknown> | null; lead: { id: string; business_id: string | null; business: Named } | null }[];
  /** null when crm.duplicate_candidates does not exist yet. */
  duplicates: Record<string, unknown>[] | null;
};

const SEVERITY_RANK: Record<TodaySeverity, number> = { high: 0, medium: 1, low: 2 };
const CHANNEL_LABELS: Record<string, string> = {
  ebook: "downloaded the ebook", quiz: "took the quiz", contact_form: "sent the contact form",
  website_contact: "sent the contact form", website_assessment: "took the assessment", calendly: "booked a call",
  stripe: "paid through Stripe", typeform: "filled in a Typeform", email_inbound: "emailed in",
};

const daysSince = (iso: string | null, today: string) => (iso ? Math.max(0, dayDiff(iso.slice(0, 10), today)) : 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Duplicate rows from A2's crm.duplicate_candidates, read defensively (its columns are not fixed yet). */
function duplicateItem(row: Record<string, unknown>, i: number): TodayItem | null {
  const s = (k: string) => (typeof row[k] === "string" && row[k] ? (row[k] as string) : null);
  if (s("dismissed_at") || s("resolved_at") || ["dismissed", "resolved", "merged", "not_duplicate"].includes(s("status") ?? "")) return null;
  const kind = s("kind") ?? s("entity_type") ?? s("record_type") ?? "business";
  const a = s("a_id") ?? s("record_a_id") ?? s("left_id") ?? s("business_a_id") ?? s("id_a");
  const label = s("a_name") ?? s("name_a") ?? s("label") ?? null;
  const link = !a ? "/crm/organizations"
    : /contact|person/.test(kind) ? `/crm/people/${a}`
    : /lead|deal/.test(kind) ? `/crm?deal=${a}`
    : `/crm/organizations/${a}`;
  const noun = /contact|person/.test(kind) ? "person" : /lead|deal/.test(kind) ? "deal" : "organization";
  return {
    id: `duplicate:${s("id") ?? i}`,
    type: "duplicate",
    title: label ? `${label} may have a duplicate` : `Possible duplicate ${noun}`,
    subtitle: s("reason") ?? s("match_reason") ?? "Review and merge, or mark as not a duplicate",
    link,
    severity: "medium",
    at: s("created_at") ?? s("detected_at"),
  };
}

/** Builds the Today queue, most pressing first. */
export function buildTodayQueue(raw: TodayRaw): TodayItem[] {
  const { today } = raw;
  const items: TodayItem[] = [];

  for (const l of raw.nextSteps) {
    if (!l.next_step || !l.next_step_due) continue;
    const d = dayDiff(today, l.next_step_due);
    if (d > 0) continue;
    const late = d < 0;
    items.push({
      id: `next_step:${l.id}`,
      type: "next_step",
      title: `${orgName(l.business)}: ${l.next_step}`,
      subtitle: dueLabel(l.next_step_due, today),
      link: `/crm?deal=${l.id}`,
      severity: late ? "high" : "medium",
      at: l.next_step_due,
      lead_id: l.id,
    });
  }

  for (const v of raw.proposedScopes) {
    const doc = v.document;
    if (!doc) continue;
    items.push({
      id: `scope:${v.id}`,
      type: "scope",
      title: `${orgName(doc.business)}: changes proposed to scope v${v.version_no}`,
      subtitle: [doc.title, v.change_note, v.created_by ? `by ${v.created_by}` : null].filter(Boolean).join(" · ") || "Waiting on you",
      link: `/crm/scope/${doc.id}`,
      severity: "medium",
      at: v.created_at,
    });
  }

  for (const b of raw.briefs) {
    if (!b.invite) continue;
    items.push({
      id: `brief:${b.id}`,
      type: "brief",
      title: `Discovery brief ready: ${orgName(b.invite.business)}`,
      subtitle: b.invite.project_title ? `${b.invite.project_title} · no scope drafted yet` : "No scope drafted yet",
      link: `/crm/discovery/${b.invite.id}`,
      severity: "medium",
      at: b.completed_at ?? b.created_at,
    });
  }

  for (const q of raw.staleQuestionnaires) {
    const days = daysSince(q.sent_at, today);
    const seen = q.status === "in_progress" ? "started, not submitted" : q.opened_at ? "opened, no answers" : "not opened";
    items.push({
      id: `questionnaire:${q.id}`,
      type: "questionnaire",
      title: `${orgName(q.business)} hasn't answered the questionnaire`,
      subtitle: `Sent ${plural(days, "day")} ago · ${seen}${q.project_title ? ` · ${q.project_title}` : ""}`,
      link: `/crm/discovery/${q.id}`,
      severity: "medium",
      at: q.sent_at,
    });
  }

  if (raw.inbox.count > 0) {
    const l = raw.inbox.latest;
    items.push({
      id: "inbox",
      type: "inbox",
      title: `${plural(raw.inbox.count, "email")} from people not in the CRM`,
      subtitle: l ? `Latest: ${l.subject?.trim() || "(no subject)"}${l.contact_email ? ` · ${l.contact_email}` : ""}` : "Sort them into contacts",
      link: "/crm/inbox",
      severity: "medium",
      at: l?.timestamp ?? null,
    });
  }

  (raw.duplicates ?? []).forEach((row, i) => {
    const it = duplicateItem(row, i);
    if (it) items.push(it);
  });

  // One item per room: the latest open or view, with a count of views.
  const rooms = new Map<string, { latest: TodayRaw["roomEvents"][number]; opens: number; views: number; who: string | null }>();
  for (const e of raw.roomEvents) {
    if (!e.engagement) continue;
    const r = rooms.get(e.engagement_id) ?? { latest: e, opens: 0, views: 0, who: null };
    if (e.created_at > r.latest.created_at) r.latest = e;
    if (e.type === "room_opened") r.opens++;
    if (e.type === "version_viewed") r.views++;
    r.who = r.who ?? e.contact?.name ?? null;
    rooms.set(e.engagement_id, r);
  }
  for (const [engId, r] of rooms) {
    const eng = r.latest.engagement!;
    const parts = [eng.title, r.opens ? `opened ${plural(r.opens, "time")}` : null, r.views ? `viewed ${plural(r.views, "version")}` : null];
    items.push({
      id: `room:${engId}`,
      type: "room",
      title: `${r.who ?? "The client"} opened ${orgName(eng.business)}'s room`,
      subtitle: parts.filter(Boolean).join(" · "),
      link: `/engagements/${engId}`,
      severity: "low",
      at: r.latest.created_at,
    });
  }

  for (const a of raw.existingClientSignups) {
    if (!a.lead) continue;
    const channel = typeof a.metadata?.channel === "string" ? a.metadata.channel : "";
    items.push({
      id: `existing_client:${a.id}`,
      type: "existing_client",
      title: `Existing client ${CHANNEL_LABELS[channel] ?? "signed up again"}: ${orgName(a.lead.business)}`,
      subtitle: "Logged on their won deal, no new lead opened. Start a new deal if it is one.",
      link: a.lead.business_id ? `/crm/organizations/${a.lead.business_id}` : `/crm/leads/${a.lead.id}`,
      severity: "low",
      at: a.created_at,
    });
  }

  return items.sort((x, y) =>
    SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity]
    // next steps: the earliest due date first; everything else: newest first
    || (x.at && y.at ? (x.type === "next_step" && y.type === "next_step" ? x.at.localeCompare(y.at) : y.at.localeCompare(x.at)) : 0));
}

export type KpiRaw = {
  leads: { stage: CRMStage; estimated_value: number | string | null }[];
  activeClients: number;
  services: { monthly_rate: number | string | null; project_rate: number | string | null }[];
  hours: { hours: number | string | null }[];
  questionnairesOut: number;
};

const num = (v: number | string | null | undefined) => {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** KPI tiles and the value-by-stage strip (non-quiz stages, without Lost). */
export function buildKpis(raw: KpiRaw): { kpis: TodayKpis; by_stage: StageValue[] } {
  const open = raw.leads.filter(l => isOpenDeal(l.stage));
  const by_stage = STAGES.filter(s => !s.isQuizStage && s.stage !== "lost").map(s => {
    const ls = raw.leads.filter(l => l.stage === s.stage);
    return { stage: s.stage, label: s.label, count: ls.length, value: round2(ls.reduce((a, l) => a + num(l.estimated_value), 0)) };
  });
  return {
    kpis: {
      open_pipeline: { value: round2(open.reduce((a, l) => a + num(l.estimated_value), 0)), count: open.length },
      active_clients: {
        count: raw.activeClients,
        contracted_monthly: round2(raw.services.reduce((a, s) => a + num(s.monthly_rate), 0)),
        contracted_project: round2(raw.services.reduce((a, s) => a + num(s.project_rate), 0)),
      },
      hours_this_month: round2(raw.hours.reduce((a, h) => a + num(h.hours), 0)),
      questionnaires_out: raw.questionnairesOut,
    },
    by_stage,
  };
}
