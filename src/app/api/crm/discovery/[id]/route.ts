import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { discoveryLink } from "@/lib/discovery";
import { snapshotFromTemplate } from "@/lib/discovery/server";
import { DraftSnapshotSchema } from "@/lib/discovery/snapshot";
import { DiscoveryProjectType } from "@/types";
import { requirePermission } from "@/lib/requirePermission";

const DETAIL_SELECT =
  "*, business:businesses(id, name, website), contact:contacts(id, first_name, last_name, email)," +
  " response:discovery_responses(*), briefs:discovery_briefs(*)";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { data, error } = await supabaseAdmin.schema("crm").from("discovery_invites")
    .select(DETAIL_SELECT).eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const row = data as unknown as Record<string, unknown> & { token: string; response: unknown; briefs?: { created_at: string }[] };
  return NextResponse.json({
    ...row,
    response: Array.isArray(row.response) ? row.response[0] ?? null : row.response,
    briefs: (row.briefs ?? []).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    link: discoveryLink(row.token),
  });
}

const PatchSchema = z.object({
  project_title: z.string().trim().min(1).max(200).optional(),
  project_brief: z.string().trim().max(10000).nullable().optional(),
  project_type: z.enum(["content_social", "operations", "fundraising", "data_reporting", "other"]).optional(),
  archived: z.boolean().optional(),
  extend_days: z.number().int().min(1).max(180).optional(),
  reopen: z.boolean().optional(),
  // Draft only: the edited questionnaire, or a template to rebuild it from.
  questionnaire_snapshot: z.unknown().optional(),
  rebuild_from_template: z.string().uuid().optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const b = parsed.data;
  const crm = supabaseAdmin.schema("crm");

  const { data: current } = await crm.from("discovery_invites").select("status, submitted_at, opened_at, project_type").eq("id", id).maybeSingle();
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const draft = current.status === "draft";

  const update: Record<string, unknown> = {};
  if (b.questionnaire_snapshot !== undefined || b.rebuild_from_template) {
    if (!draft) return NextResponse.json({ error: "This questionnaire has been sent and can no longer be edited" }, { status: 409 });
  }
  if (b.questionnaire_snapshot !== undefined) {
    const snap = DraftSnapshotSchema.safeParse(b.questionnaire_snapshot);
    if (!snap.success) return NextResponse.json({ error: snap.error.issues[0]?.message ?? "Invalid questionnaire" }, { status: 400 });
    update.questionnaire_snapshot = snap.data;
  }
  if (b.rebuild_from_template) {
    const pt = (b.project_type ?? current.project_type) as DiscoveryProjectType;
    const snap = await snapshotFromTemplate(b.rebuild_from_template, pt).catch(() => null);
    if (!snap) return NextResponse.json({ error: "Template not found" }, { status: 400 });
    update.questionnaire_snapshot = snap;
    update.template_id = b.rebuild_from_template;
  }
  if (draft && (b.archived !== undefined || b.reopen)) {
    return NextResponse.json({ error: "Drafts can't be archived or reopened — delete the draft instead" }, { status: 409 });
  }
  if (b.project_title !== undefined) update.project_title = b.project_title;
  if (b.project_brief !== undefined) update.project_brief = b.project_brief;
  if (b.project_type !== undefined) {
    if (current.status === "submitted") return NextResponse.json({ error: "Can't change project type after submission" }, { status: 409 });
    update.project_type = b.project_type;
  }
  if (b.extend_days) update.expires_at = new Date(Date.now() + b.extend_days * 86_400_000).toISOString();
  if (b.archived === true) update.status = "archived";
  if (b.archived === false) update.status = current.submitted_at ? "submitted" : current.opened_at ? "opened" : "sent";
  // Let the respondent edit again (e.g. they asked to add something). Keeps their answers.
  if (b.reopen) { update.status = "in_progress"; update.submitted_at = null; }

  const { error } = await crm.from("discovery_invites").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return GET(req, { params });
}

// DELETE /api/crm/discovery/:id — any status. Responses and briefs cascade; a linked
// room keeps going without the link. The prospect's link stops working immediately.
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const crm = supabaseAdmin.schema("crm");
  const { data: invite, error: le } = await crm.from("discovery_invites")
    .select("id, lead_id, project_title, status, response:discovery_responses(id)")
    .eq("id", id).maybeSingle();
  if (le) return NextResponse.json({ error: le.message }, { status: 500 });
  if (!invite) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const response = (invite as { response?: unknown }).response;
  const hadResponse = Array.isArray(response) ? response.length > 0 : !!response;

  const { data, error } = await crm.from("discovery_invites").delete().eq("id", id).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Not `discovery_invite_id`: that key marks timeline entries for a live invite.
  const { error: ae } = await crm.from("lead_activities").insert({
    lead_id: invite.lead_id,
    activity_type: "system",
    logged_by: "brian",
    content: `Discovery questionnaire deleted: ${invite.project_title}`,
    metadata: { deleted_discovery_invite_id: invite.id, status: invite.status, had_response: hadResponse },
  });
  if (ae) console.error("discovery delete: timeline log failed", ae.message);
  return NextResponse.json({ ok: true });
}
