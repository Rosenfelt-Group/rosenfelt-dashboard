import { supabaseAdmin } from "@/lib/supabase-admin";
import { BUILD_CLOSED_STATUSES, BUILD_LOG_LIMIT, deliverableIdFromBrief, isStalled, type Build, type BuildLog } from "@/lib/rooms/builds";

const MSG_MAX = 300;

// Open agent prototype requests (work items) for the given prototype deliverables, with the agent's latest
// log lines. A request is finished once its work item has produced a version, whether or not the agent
// closed the item. Returns null when a query fails.
export async function findOpenBuilds(deliverableIds: Set<string>, nowMs: number): Promise<Build[] | null> {
  if (deliverableIds.size === 0) return [];

  const { data: items, error: wErr } = await supabaseAdmin.from("work_items")
    .select("id, ref, status, assigned_agent, description, created_at, updated_at")
    .eq("work_type", "deliverable")
    .like("description", "ROOMS_PROTOTYPE_REQUEST v1%")
    .not("status", "in", `(${BUILD_CLOSED_STATUSES.join(",")})`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (wErr) return null;

  const candidates = (items ?? [])
    .map((w: Record<string, unknown>) => ({ w, did: deliverableIdFromBrief(w.description) }))
    .filter((x): x is { w: Record<string, unknown>; did: string } => x.did !== null && deliverableIds.has(x.did));

  let mine = candidates;
  if (candidates.length > 0) {
    const { data: vers, error: vErr } = await supabaseAdmin.schema("rooms").from("deliverable_versions")
      .select("work_item_id").in("work_item_id", candidates.map(x => x.w.id as string));
    if (vErr) return null;
    const done = new Set((vers ?? []).map((v: { work_item_id: string }) => v.work_item_id));
    mine = candidates.filter(x => !done.has(x.w.id as string));
  }
  if (mine.length === 0) return [];

  const { data: logs, error: lErr } = await supabaseAdmin.from("work_item_logs")
    .select("work_item_id, created_at, author, entry_type, message")
    .in("work_item_id", mine.map(x => x.w.id as string))
    .order("created_at", { ascending: false })
    .limit(200);
  if (lErr) return null;

  const byItem = new Map<string, BuildLog[]>();
  const newestFirst = [...((logs ?? []) as Record<string, unknown>[])]
    .sort((a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at)));
  for (const l of newestFirst) {
    const key = l.work_item_id as string;
    const list = byItem.get(key) ?? [];
    if (list.length < BUILD_LOG_LIMIT) {
      list.push({ at: String(l.created_at), author: String(l.author ?? ""), type: String(l.entry_type ?? ""), message: String(l.message ?? "").slice(0, MSG_MAX) });
      byItem.set(key, list);
    }
  }

  return mine.map(({ w, did }) => {
    const wid = w.id as string;
    const lg = byItem.get(wid) ?? [];
    const last = lg[0]?.at ?? String(w.updated_at ?? w.created_at);
    return {
      deliverable_id: did, work_item_id: wid, ref: typeof w.ref === "number" ? w.ref : null,
      status: String(w.status), agent: typeof w.assigned_agent === "string" ? w.assigned_agent : null,
      requested_at: String(w.created_at), last_activity_at: last, stalled: isStalled(last, nowMs), logs: lg,
    };
  });
}
