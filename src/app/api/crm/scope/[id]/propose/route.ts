import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { requestScopeRevision, RileyNotConfiguredError } from "@/lib/riley/client";
import { countSelected, ResearchError } from "@/lib/research/org-research";

// Riley drafts the revision synchronously (one model call); it lands as a proposed version to accept or reject.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

const BodySchema = z.object({ instructions: z.string().trim().max(2000).optional() });

/** Ask Riley to propose a revision of this scope using the research ticked for its organization. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const { data: doc, error } = await supabaseAdmin.schema("crm").from("scope_documents")
    .select("id, business_id, current_version_id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!doc.current_version_id) return NextResponse.json({ error: "This scope has no current version yet" }, { status: 409 });

  try {
    if ((await countSelected(doc.business_id)) === 0)
      return NextResponse.json({ error: "Tick at least one research item to use in the scope first" }, { status: 409 });
    const r = await requestScopeRevision(id, parsed.data.instructions || undefined);
    if (!r.ok) {
      if (r.kind === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (r.kind === "conflict") return NextResponse.json({ error: "Riley couldn't propose a revision now (no research selected, or too many pending proposals)" }, { status: 409 });
      if (r.kind === "unreachable") return NextResponse.json({ error: "Riley could not be reached. Try again in a minute." }, { status: 502 });
      return NextResponse.json({ error: "Riley could not propose a revision. Try again." }, { status: 502 });
    }
    const { status, scope_version_id, change_note, research_used } = r.data;
    return NextResponse.json({ status, scope_version_id, change_note, research_used });
  } catch (e) {
    if (e instanceof RileyNotConfiguredError) return NextResponse.json({ error: "Riley discovery is not configured" }, { status: 503 });
    if (e instanceof ResearchError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
