import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { BUILD_CLOSED_STATUSES, BUILD_LOG_LIMIT, deliverableIdFromBrief, isStalled, type Build, type BuildLog } from "@/lib/rooms/builds";
import { requirePermission } from "@/lib/requirePermission";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MSG_MAX = 300;
const fail = () => NextResponse.json({ error: "Could not load build status." }, { status: 500 });

// GET — open agent prototype requests (work items) for this engagement's prototype deliverables, with
// the agent's latest log lines. Read-only. Dashboard session required by the middleware.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const nowMs = Date.now();

  const { data: dels, error: dErr } = await supabaseAdmin.schema("rooms").from("deliverables")
    .select("id").eq("engagement_id", id).eq("kind", "prototype");
  if (dErr) return fail();
  const ids = new Set((dels ?? []).map((d: { id: string }) => d.id));
  if (ids.size === 0) return NextResponse.json({ builds: [], now: new Date(nowMs).toISOString() });

  const { data: items, error: wErr } = await supabaseAdmin.from("work_items")
    .select("id, ref, status, assigned_agent, description, created_at, updated_at")
    .eq("work_type", "deliverable")
    .like("description", "ROOMS_PROTOTYPE_REQUEST v1%")
    .not("status", "in", `(${BUILD_CLOSED_STATUSES.join(",")})`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (wErr) return fail();

  const candidates = (items ?? [])
    .map((w: Record<string, unknown>) => ({ w, did: deliverableIdFromBrief(w.description) }))
    .filter((x): x is { w: Record<string, unknown>; did: string } => x.did !== null && ids.has(x.did));

  // A request is finished once its work item has produced a version, whether or not the agent closed the item.
  let mine = candidates;
  if (candidates.length > 0) {
    const { data: vers, error: vErr } = await supabaseAdmin.schema("rooms").from("deliverable_versions")
      .select("work_item_id").in("work_item_id", candidates.map(x => x.w.id as string));
    if (vErr) return fail();
    const done = new Set((vers ?? []).map((v: { work_item_id: string }) => v.work_item_id));
    mine = candidates.filter(x => !done.has(x.w.id as string));
  }
  if (mine.length === 0) return NextResponse.json({ builds: [], now: new Date(nowMs).toISOString() });

  const { data: logs, error: lErr } = await supabaseAdmin.from("work_item_logs")
    .select("work_item_id, created_at, author, entry_type, message")
    .in("work_item_id", mine.map(x => x.w.id as string))
    .order("created_at", { ascending: false })
    .limit(200);
  if (lErr) return fail();

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

  const builds: Build[] = mine.map(({ w, did }) => {
    const wid = w.id as string;
    const lg = byItem.get(wid) ?? [];
    const last = lg[0]?.at ?? String(w.updated_at ?? w.created_at);
    return {
      deliverable_id: did, work_item_id: wid, ref: typeof w.ref === "number" ? w.ref : null,
      status: String(w.status), agent: typeof w.assigned_agent === "string" ? w.assigned_agent : null,
      requested_at: String(w.created_at), last_activity_at: last, stalled: isStalled(last, nowMs), logs: lg,
    };
  });
  return NextResponse.json({ builds, now: new Date(nowMs).toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
}
