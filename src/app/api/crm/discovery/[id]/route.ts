import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { discoveryLink } from "@/lib/discovery";

const DETAIL_SELECT =
  "*, business:businesses(id, name, website), contact:contacts(id, first_name, last_name, email)," +
  " response:discovery_responses(*), briefs:discovery_briefs(*)";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Ctx) {
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
});

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const b = parsed.data;
  const crm = supabaseAdmin.schema("crm");

  const { data: current } = await crm.from("discovery_invites").select("status, submitted_at, opened_at").eq("id", id).maybeSingle();
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const update: Record<string, unknown> = {};
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
