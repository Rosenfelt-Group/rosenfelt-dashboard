import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { DISCOVERY_SITE } from "@/lib/discovery";
import { requirePermission } from "@/lib/requirePermission";

// Brief generation runs on rosably.com (it holds the Anthropic key and the prompt);
// this route queues a fresh brief and asks the site to run it.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const crm = supabaseAdmin.schema("crm");

  const { data: invite } = await crm.from("discovery_invites").select("id, token, status").eq("id", id).maybeSingle();
  if (!invite) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invite.status !== "submitted") return NextResponse.json({ error: "Questionnaire hasn't been submitted yet" }, { status: 409 });

  // Retire the live brief (if any) so the partial unique index allows a new pending row.
  await crm.from("discovery_briefs").update({ status: "superseded" }).eq("invite_id", id).in("status", ["pending", "ready"]);
  const { error: ie } = await crm.from("discovery_briefs").insert({ invite_id: id, status: "pending" });
  if (ie) return NextResponse.json({ error: ie.message }, { status: 500 });

  try {
    const res = await fetch(`${DISCOVERY_SITE}/wp-json/rosably/v1/discovery/brief`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: invite.token }),
      signal: AbortSignal.timeout(280_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ error: body.message ?? `Site returned ${res.status}` }, { status: 502 });
  } catch (e) {
    return NextResponse.json({ error: `Could not reach ${DISCOVERY_SITE}: ${(e as Error).message}` }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
