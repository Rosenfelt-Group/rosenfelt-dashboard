// Pure helpers for the pipeline board, the deal drawer and Today (no server imports).
import { CRMLead, CRMStage } from "@/types";
import { STAGES, StageMeta } from "./stages";

/** Lead fields added by docs/migrations/2026-10-25_d_leads_next_step.sql. */
export type PipelineLead = CRMLead & {
  next_step?: string | null;
  next_step_due?: string | null;
  stage_entered_at?: string | null;
};

export type PipelineColumn = {
  id: string;
  label: string;
  stages: CRMStage[];
  /** The automated quiz funnel: drawn dashed and not a drop target. */
  isQuizFunnel: boolean;
  color: string;
};

/** Board columns: the three quiz stages collapse into one "Quiz funnel" column; every other stage keeps its own. */
export function pipelineColumns(stages: StageMeta[] = STAGES): PipelineColumn[] {
  const quiz = stages.filter(s => s.isQuizStage);
  const cols: PipelineColumn[] = [];
  if (quiz.length) {
    cols.push({ id: "quiz", label: "Quiz funnel", stages: quiz.map(s => s.stage), isQuizFunnel: true, color: quiz[0].color });
  }
  for (const s of stages.filter(x => !x.isQuizStage)) {
    cols.push({ id: s.stage, label: s.label, stages: [s.stage], isQuizFunnel: false, color: s.color });
  }
  return cols;
}

/** Leads grouped by board column id, in the given lead order. */
export function groupByColumn<T extends { stage: CRMStage }>(leads: T[], columns = pipelineColumns()): Record<string, T[]> {
  const out: Record<string, T[]> = Object.fromEntries(columns.map(c => [c.id, [] as T[]]));
  const colOf = new Map<CRMStage, string>();
  for (const c of columns) for (const s of c.stages) colOf.set(s, c.id);
  for (const l of leads) {
    const id = colOf.get(l.stage);
    if (id) out[id].push(l);
  }
  return out;
}

export const OPEN_EXCLUDED: CRMStage[] = ["won", "lost"];
/** An open deal: past the quiz funnel and not won or lost. */
export function isOpenDeal(stage: CRMStage): boolean {
  return !OPEN_EXCLUDED.includes(stage) && !STAGES.find(s => s.stage === stage)?.isQuizStage;
}

const DAY = 86_400_000;

/** Whole days since the lead entered its stage (falls back to updated_at for rows read before the migration). */
export function daysInStage(lead: Pick<PipelineLead, "stage_entered_at" | "updated_at">, now = new Date()): number {
  const t = new Date(lead.stage_entered_at ?? lead.updated_at).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / DAY)) : 0;
}

/** YYYY-MM-DD for `d` in Brian's time zone. */
export function localDate(d = new Date(), timeZone = "America/New_York"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);
}

/** Calendar days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

/** `date` (YYYY-MM-DD) plus `n` days. */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

export type DueState = "late" | "today" | "soon" | "later" | "none";

/** Where a next-step due date stands relative to `today` (YYYY-MM-DD). */
export function dueState(due: string | null | undefined, today: string): DueState {
  if (!due) return "none";
  const d = dayDiff(today, due);
  if (d < 0) return "late";
  if (d === 0) return "today";
  if (d === 1) return "soon";
  return "later";
}

/** "2 days late", "Due today", "Due tomorrow" or "Due Oct 30". */
export function dueLabel(due: string | null | undefined, today: string): string {
  if (!due) return "";
  const d = dayDiff(today, due);
  if (d < 0) return `${-d} ${d === -1 ? "day" : "days"} late`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  const dt = new Date(`${due}T12:00:00Z`);
  return `Due ${dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

export const ENGAGEMENT_STEPS = ["discovery", "scope", "room", "delivery"] as const;
export type EngagementStep = typeof ENGAGEMENT_STEPS[number];
export const ENGAGEMENT_STEP_LABELS: Record<EngagementStep, string> = {
  discovery: "Discovery", scope: "Scope", room: "Room", delivery: "Delivery",
};
/** Which engagement steps a lead has reached (a discovery invite, a scope document, a room, a client record). */
export type EngagementProgress = Record<EngagementStep, boolean>;
export const NO_PROGRESS: EngagementProgress = { discovery: false, scope: false, room: false, delivery: false };

/** Number of steps reached counting from the start, e.g. 2 = discovery and scope; later steps reached out of order still count. */
export function progressLevel(p: EngagementProgress | undefined): number {
  if (!p) return 0;
  let last = -1;
  ENGAGEMENT_STEPS.forEach((s, i) => { if (p[s]) last = i; });
  return last + 1;
}

/** Whole-dollar money, e.g. $12,500. */
export function money(v: number | null | undefined): string {
  return `$${Math.round(Number(v ?? 0)).toLocaleString("en-US")}`;
}
