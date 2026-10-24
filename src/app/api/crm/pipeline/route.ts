import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { NO_PROGRESS, type EngagementProgress, type EngagementStep } from "@/lib/crm/pipeline";

// Engagement progress per lead for the pipeline cards and the deal drawer:
// discovery (a questionnaire was sent) → scope (a scope document) → room (an engagement room) → delivery (a client record).
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const crm = supabaseAdmin.schema("crm");
  const [invites, scopes, rooms, clients] = await Promise.all([
    crm.from("discovery_invites").select("lead_id").not("status", "in", "(draft,archived)").is("deleted_at", null),
    crm.from("scope_documents").select("lead_id").not("lead_id", "is", null).is("deleted_at", null),
    supabaseAdmin.schema("rooms").from("engagements").select("lead_id").not("lead_id", "is", null).is("deleted_at", null),
    crm.from("clients").select("lead_id").not("lead_id", "is", null).is("deleted_at", null),
  ]);
  const failed = [invites, scopes, rooms, clients].find(r => r.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });

  const progress: Record<string, EngagementProgress> = {};
  const mark = (rows: { lead_id: string | null }[] | null, step: EngagementStep) => {
    for (const r of rows ?? []) {
      if (!r.lead_id) continue;
      (progress[r.lead_id] ??= { ...NO_PROGRESS })[step] = true;
    }
  };
  mark(invites.data, "discovery");
  mark(scopes.data, "scope");
  mark(rooms.data, "room");
  mark(clients.data, "delivery");
  return NextResponse.json({ progress });
}
