// Server-only. Loads the rows behind the CRM Today page and hands them to the pure builder.
// Every list of a soft-deletable table filters deleted_at (see the CRM build plan's soft delete contract).
import { supabaseAdmin } from "@/lib/supabase-admin";
import { CRMStage } from "@/types";
import { localDate } from "./pipeline";
import { buildKpis, buildTodayQueue, type TodayRaw, type TodayResponse } from "./today-queue";

/** A questionnaire counts as unanswered after this many days. */
export const QUESTIONNAIRE_STALE_DAYS = 5;
/** Room opens and views newer than this show up. */
export const ROOM_RECENT_DAYS = 3;
/** Existing-client signups (intake rule R11) newer than this show up. */
export const SIGNUP_RECENT_DAYS = 14;
const OUT_STATUSES = ["sent", "opened", "in_progress"];
const DAY = 86_400_000;

type Row = Record<string, unknown>;
type Named = { name: string | null } | null;

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return (r.data ?? []) as T;
}

/** crm.duplicate_candidates arrives with stream A2; until then the queue simply has no duplicates. */
async function loadDuplicates(): Promise<Row[] | null> {
  const r = await supabaseAdmin.schema("crm").from("duplicate_candidates").select("*").limit(50);
  if (r.error) {
    // PGRST205: not in the schema cache; 42P01: undefined table.
    if (r.error.code !== "PGRST205" && r.error.code !== "42P01") console.error("today: duplicate_candidates:", r.error.message);
    return null;
  }
  return (r.data ?? []) as Row[];
}

export async function loadToday(now = new Date()): Promise<TodayResponse> {
  const crm = supabaseAdmin.schema("crm");
  const rooms = supabaseAdmin.schema("rooms");
  const today = localDate(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();

  const [
    inboxCount, inboxLatest, briefs, scopes, stale, roomEvents, nextSteps, signups, duplicates,
    leads, clients, hours, questionnairesOut,
  ] = await Promise.all([
    crm.from("unmatched_email_log").select("id", { count: "exact", head: true }).is("resolved_at", null),
    crm.from("unmatched_email_log").select("subject, contact_email, timestamp").is("resolved_at", null)
      .order("timestamp", { ascending: false }).limit(1),
    crm.from("discovery_briefs")
      .select("id, completed_at, created_at, invite:discovery_invites!inner(id, lead_id, project_title, status, deleted_at, business:businesses(name), lead:leads!inner(stage, deleted_at))")
      .eq("status", "ready").is("scope_version_id", null)
      .is("invite.deleted_at", null).neq("invite.status", "archived")
      .is("invite.lead.deleted_at", null).neq("invite.lead.stage", "lost")
      .order("completed_at", { ascending: false }).limit(20),
    crm.from("scope_versions")
      .select("id, version_no, created_at, created_by, change_note, document:scope_documents!scope_versions_scope_document_id_fkey!inner(id, title, deleted_at, business:businesses(name))")
      .eq("status", "proposed").is("document.deleted_at", null)
      .order("created_at", { ascending: false }).limit(20),
    crm.from("discovery_invites")
      .select("id, project_title, sent_at, opened_at, status, business:businesses(name), lead:leads!inner(stage, deleted_at)")
      .in("status", OUT_STATUSES).is("submitted_at", null).is("deleted_at", null)
      .lt("sent_at", ago(QUESTIONNAIRE_STALE_DAYS)).gt("expires_at", now.toISOString())
      .is("lead.deleted_at", null).neq("lead.stage", "lost")
      .order("sent_at", { ascending: true }).limit(20),
    rooms.from("engagement_events")
      .select("engagement_id, type, created_at, engagement:engagements!inner(id, title, business_id, deleted_at), contact:engagement_contacts(name)")
      .in("type", ["room_opened", "version_viewed"]).gt("created_at", ago(ROOM_RECENT_DAYS))
      .is("engagement.deleted_at", null)
      .order("created_at", { ascending: false }).limit(200),
    crm.from("leads").select("id, next_step, next_step_due, business:businesses(name)")
      .not("next_step", "is", null).lte("next_step_due", today).not("stage", "in", "(won,lost)").is("deleted_at", null)
      .order("next_step_due", { ascending: true }).limit(50),
    crm.from("lead_activities")
      .select("id, created_at, metadata, lead:leads!inner(id, business_id, deleted_at, business:businesses(name))")
      .eq("activity_type", "intake").eq("metadata->>existing_client", "true").gt("created_at", ago(SIGNUP_RECENT_DAYS))
      .is("lead.deleted_at", null)
      .order("created_at", { ascending: false }).limit(20),
    loadDuplicates(),
    crm.from("leads").select("stage, estimated_value").is("deleted_at", null),
    crm.from("clients").select("id, services:client_services(monthly_rate, project_rate, status)")
      .eq("billing_status", "active").is("deleted_at", null),
    crm.from("tm_billing_entries").select("hours").gte("entry_date", monthStart),
    crm.from("discovery_invites").select("id", { count: "exact", head: true }).in("status", OUT_STATUSES).is("deleted_at", null),
  ]);

  if (inboxCount.error) throw new Error(`inbox: ${inboxCount.error.message}`);
  if (questionnairesOut.error) throw new Error(`questionnaires: ${questionnairesOut.error.message}`);

  // Room engagements live in the rooms schema, so their organization names come in a second query.
  const events = must(roomEvents, "room events") as unknown as (Omit<TodayRaw["roomEvents"][number], "engagement"> & {
    engagement: { id: string; title: string | null; business_id: string } | null;
  })[];
  const bizIds = [...new Set(events.map(e => e.engagement?.business_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (bizIds.length) {
    const b = must(await crm.from("businesses").select("id, name").in("id", bizIds), "room businesses") as { id: string; name: string }[];
    for (const x of b) names.set(x.id, x.name);
  }

  // A brief only needs you while its deal has no scope yet (scope_version_id is unset when the scope was started by hand).
  const briefRows = must(briefs, "briefs") as unknown as (TodayRaw["briefs"][number] & { invite: { lead_id: string } | null })[];
  const briefLeads = [...new Set(briefRows.map(b => b.invite?.lead_id).filter((x): x is string => !!x))];
  const scoped = new Set<string>();
  if (briefLeads.length) {
    const d = must(await crm.from("scope_documents").select("lead_id").in("lead_id", briefLeads).is("deleted_at", null), "brief scopes") as { lead_id: string }[];
    for (const x of d) scoped.add(x.lead_id);
  }

  const clientRows = must(clients, "clients") as { id: string; services: { monthly_rate: number | null; project_rate: number | null; status: string }[] | null }[];

  const raw: TodayRaw = {
    today,
    now: now.toISOString(),
    inbox: { count: inboxCount.count ?? 0, latest: (must(inboxLatest, "inbox") as TodayRaw["inbox"]["latest"][])[0] ?? null },
    briefs: briefRows.filter(b => !b.invite || !scoped.has(b.invite.lead_id)),
    proposedScopes: must(scopes, "scopes") as unknown as TodayRaw["proposedScopes"],
    staleQuestionnaires: must(stale, "questionnaires") as unknown as TodayRaw["staleQuestionnaires"],
    roomEvents: events.map(e => ({
      ...e,
      engagement: e.engagement && { id: e.engagement.id, title: e.engagement.title, business: { name: names.get(e.engagement.business_id) ?? null } as Named },
    })),
    nextSteps: must(nextSteps, "next steps") as unknown as TodayRaw["nextSteps"],
    existingClientSignups: must(signups, "signups") as unknown as TodayRaw["existingClientSignups"],
    duplicates,
  };

  const { kpis, by_stage } = buildKpis({
    leads: must(leads, "leads") as { stage: CRMStage; estimated_value: number | null }[],
    activeClients: clientRows.length,
    services: clientRows.flatMap(c => (c.services ?? []).filter(s => s.status === "active" || s.status === "pending_activation")),
    hours: must(hours, "hours") as { hours: number | null }[],
    questionnairesOut: questionnairesOut.count ?? 0,
  });

  return {
    generated_at: now.toISOString(),
    today,
    items: buildTodayQueue(raw),
    kpis,
    by_stage,
    duplicates_checked: duplicates !== null,
  };
}
