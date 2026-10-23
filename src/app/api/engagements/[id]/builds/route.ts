import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { findOpenBuilds } from "@/lib/rooms/open-builds";
import { requirePermission } from "@/lib/requirePermission";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

  const builds = await findOpenBuilds(ids, nowMs);
  if (builds === null) return fail();
  if (builds.length === 0) return NextResponse.json({ builds: [], now: new Date(nowMs).toISOString() });
  return NextResponse.json({ builds, now: new Date(nowMs).toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
}
