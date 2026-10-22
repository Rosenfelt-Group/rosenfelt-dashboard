import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { RileyNotConfiguredError } from "@/lib/riley/discovery";
import { runBrief } from "@/lib/discovery/briefs";
import { riley502 } from "@/lib/discovery/riley-errors";

// Brief generation runs on Riley (R65): this route queues a fresh brief row and waits for Riley's
// synchronous endpoint. Riley marks the brief failed itself when it errors; we do it only when
// Riley never answered.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const crm = supabaseAdmin.schema("crm");

  const { data: invite } = await crm.from("discovery_invites").select("id, status").eq("id", id).maybeSingle();
  if (!invite) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invite.status !== "submitted") return NextResponse.json({ error: "Questionnaire hasn't been submitted yet" }, { status: 409 });

  // Retire the live brief (if any) so the partial unique index allows a new pending row.
  await crm.from("discovery_briefs").update({ status: "superseded" }).eq("invite_id", id).in("status", ["pending", "ready"]);
  const { error: ie } = await crm.from("discovery_briefs").insert({ invite_id: id, status: "pending" });
  if (ie) return NextResponse.json({ error: ie.message }, { status: 500 });

  try {
    const r = await runBrief(id);
    if (!r.ok) return riley502(r, "Riley could not generate the brief. Try again.");
    const { status, brief_id, scope_version_id, fit_verdict } = r.data;
    return NextResponse.json({ status, brief_id, scope_version_id, fit_verdict });
  } catch (e) {
    if (e instanceof RileyNotConfiguredError) return NextResponse.json({ error: "Riley discovery is not configured" }, { status: 503 });
    throw e;
  }
}
