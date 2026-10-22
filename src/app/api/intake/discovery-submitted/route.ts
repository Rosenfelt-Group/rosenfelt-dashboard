import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { identifyCaller } from "@/lib/intake/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { runBrief } from "@/lib/discovery/briefs";

// WordPress -> dashboard: a discovery questionnaire was submitted. Queues the brief and returns 202
// at once; Riley's brief endpoint (synchronous, up to minutes) runs in after(). Bearer auth as in
// /api/intake, but only the "wordpress" caller (excluded from session auth in middleware).
export const maxDuration = 300;

const Body = z.object({ invite_id: z.string().uuid() });

export async function POST(req: NextRequest) {
  const caller = identifyCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (caller !== "wordpress") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invite_id (uuid) is required" }, { status: 400 });
  const inviteId = parsed.data.invite_id;

  const crm = supabaseAdmin.schema("crm");
  const { data: invite } = await crm.from("discovery_invites").select("id, status").eq("id", inviteId).maybeSingle();
  if (!invite) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invite.status !== "submitted") return NextResponse.json({ error: "Questionnaire hasn't been submitted" }, { status: 409 });

  // Ensure a live (pending/ready) brief exists. The partial unique index makes a race harmless.
  const { data: live } = await crm.from("discovery_briefs").select("id").eq("invite_id", inviteId).in("status", ["pending", "ready"]).limit(1);
  if (!live?.length) {
    const { error } = await crm.from("discovery_briefs").insert({ invite_id: inviteId, status: "pending" });
    if (error && error.code !== "23505") {
      console.error("discovery-submitted: could not queue brief", inviteId, error.message);
      return NextResponse.json({ error: "Could not queue the brief" }, { status: 500 });
    }
  }

  after(async () => {
    try {
      await runBrief(inviteId);
    } catch (e) {
      console.error("discovery-submitted: brief run failed", inviteId, e instanceof Error ? e.message : e);
    }
  });
  return NextResponse.json({ queued: true }, { status: 202 });
}
