import { supabaseAdmin } from "@/lib/supabase-admin";
import { DiscoveryQuestionnaireDef } from "@/types";
import { discoveryLink } from "./index";
import { SnapshotSchema, dropDanglingShowIf, estimateMinutes } from "./snapshot";

export type SendResult =
  | { ok: true; inviteId: string; token: string; link: string; leadId: string }
  | { ok: false; status: number; error: string };

const DAY = 86_400_000;

/**
 * Send a draft invite: validate and freeze its questionnaire, mark it sent and
 * log it on the lead. The database trigger makes the snapshot immutable from here.
 *
 * This is the single place a discovery questionnaire goes out, so delivery steps
 * (e.g. emailing the prospect) belong here, after the freeze succeeds.
 */
export async function finalizeSend(inviteId: string): Promise<SendResult> {
  const crm = supabaseAdmin.schema("crm");
  const { data: invite, error: le } = await crm.from("discovery_invites")
    .select("id, token, lead_id, status, project_title, questionnaire_snapshot, created_at, expires_at")
    .eq("id", inviteId).maybeSingle();
  if (le) return { ok: false, status: 500, error: le.message };
  if (!invite) return { ok: false, status: 404, error: "Not found" };
  if (invite.status !== "draft") return { ok: false, status: 409, error: "This questionnaire has already been sent." };

  const parsed = SnapshotSchema.safeParse(invite.questionnaire_snapshot);
  if (!parsed.success) return { ok: false, status: 422, error: parsed.error.issues[0]?.message ?? "The questionnaire is incomplete" };
  const snapshot = dropDanglingShowIf(parsed.data as DiscoveryQuestionnaireDef);
  snapshot.estimated_minutes ??= estimateMinutes(snapshot);

  // Keep the validity window chosen at creation, counted from the send.
  const windowMs = Math.max(7 * DAY, new Date(invite.expires_at).getTime() - new Date(invite.created_at).getTime());
  const now = new Date();

  // Conditional on still being a draft, so a double-click can't send twice.
  const { data: sent, error: ue } = await crm.from("discovery_invites")
    .update({
      status: "sent",
      sent_at: now.toISOString(),
      expires_at: new Date(now.getTime() + windowMs).toISOString(),
      questionnaire_snapshot: snapshot,
    })
    .eq("id", inviteId).eq("status", "draft")
    .select("id").maybeSingle();
  if (ue) return { ok: false, status: 500, error: ue.message };
  if (!sent) return { ok: false, status: 409, error: "This questionnaire has already been sent." };

  await crm.from("lead_activities").insert({
    lead_id: invite.lead_id,
    activity_type: "system",
    logged_by: "brian",
    content: `Discovery questionnaire sent: ${invite.project_title}`,
    metadata: { discovery_invite_id: invite.id, template: snapshot.template?.name ?? null },
  });

  return { ok: true, inviteId: invite.id, token: invite.token, link: discoveryLink(invite.token), leadId: invite.lead_id };
}
