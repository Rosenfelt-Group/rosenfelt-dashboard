import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { draftQuestionnaire, RileyNotConfiguredError } from "@/lib/riley/client";
import { riley502 } from "@/lib/discovery/riley-errors";

// Riley (Opus) drafts the questionnaire for a draft invite and writes questionnaire_snapshot itself.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: invite } = await supabaseAdmin.schema("crm").from("discovery_invites").select("id, status").eq("id", id).maybeSingle();
  if (!invite) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invite.status !== "draft") return NextResponse.json({ error: "Only a draft questionnaire can be drafted by Riley" }, { status: 409 });

  try {
    const r = await draftQuestionnaire(id);
    if (!r.ok) return riley502(r, "Riley could not draft the questionnaire. Try again.");
    return NextResponse.json({ sections: r.data.sections, added_custom: r.data.added_custom });
  } catch (e) {
    if (e instanceof RileyNotConfiguredError) return NextResponse.json({ error: "Riley discovery is not configured" }, { status: 503 });
    throw e;
  }
}
