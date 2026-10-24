import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { getLiveBusiness, loadOrgResearch, ResearchError, runOrgResearch } from "@/lib/research/org-research";

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

function errorResponse(e: unknown): NextResponse {
  if (e instanceof ResearchError) return NextResponse.json({ error: e.message }, { status: e.status });
  throw e;
}

/** The organization's research: { notes, briefs, selected_count, total }, each item with `selected`. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  try {
    if (!(await getLiveBusiness(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(await loadOrgResearch(id));
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * { note } saves Brian's own note. { topic } runs Avery's research on the organization (synchronous) and
 * returns the new crm.business_research row.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!note && !topic) return NextResponse.json({ error: "note or topic is required" }, { status: 400 });
  if (note.length > 10_000) return NextResponse.json({ error: "Note is too long (10,000 characters maximum)" }, { status: 400 });

  try {
    if (!(await getLiveBusiness(id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!note) return NextResponse.json(await runOrgResearch(id, topic), { status: 201 });

    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    const { data, error } = await supabaseAdmin.schema("crm").from("business_research")
      .insert({ business_id: id, summary: note, details: title ? { title } : {}, source: "manual", researched_by: guard.username })
      .select("id, summary, details, source, researched_by, created_at").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
