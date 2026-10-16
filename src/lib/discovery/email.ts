import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { DiscoveryQuestionnaireDef } from "@/types";
import { sendEmail, isEmailConfigured, EmailError } from "@/lib/email/gmail";
import { discoveryLink } from "./index";
import { estimateMinutes } from "./snapshot";
import { inviteEmail, inviteSubject } from "./invite-email";

export const EmailSchema = z.object({
  to: z.string().trim(),
  firstName: z.string().trim().max(80).optional(),
});

export type EmailRequest = { to: string; firstName?: string };
export type EmailOutcome = { sent: true; id: string } | { sent: false; status: number; error: string };

const EMAILABLE = new Set(["sent", "opened", "in_progress"]);

/**
 * Email the invite link for a questionnaire that has already been sent (frozen). Used straight after
 * finalizeSend and by "Resend email". Never changes the invite; errors are safe to show the user.
 */
export async function emailInvite(inviteId: string, req: EmailRequest): Promise<EmailOutcome> {
  if (!isEmailConfigured()) return { sent: false, status: 503, error: "Email isn't set up. Copy the invite instead." };
  const crm = supabaseAdmin.schema("crm");
  const { data: invite, error: le } = await crm.from("discovery_invites")
    .select("id, token, lead_id, status, project_title, questionnaire_snapshot, expires_at, business:businesses(name)")
    .eq("id", inviteId).maybeSingle();
  if (le) return { sent: false, status: 500, error: "Could not load the questionnaire." };
  if (!invite) return { sent: false, status: 404, error: "Not found" };
  if (!EMAILABLE.has(invite.status) || new Date(invite.expires_at).getTime() <= Date.now()) {
    return { sent: false, status: 409, error: "Only an open, unexpired questionnaire can be emailed." };
  }

  const snapshot = invite.questionnaire_snapshot as DiscoveryQuestionnaireDef | null;
  const business = (Array.isArray(invite.business) ? invite.business[0] : invite.business) as { name?: string } | null;
  const subject = inviteSubject({ projectTitle: invite.project_title });
  const text = inviteEmail({
    firstName: req.firstName, orgName: business?.name ?? undefined, projectTitle: invite.project_title,
    link: discoveryLink(invite.token), minutes: snapshot ? snapshot.estimated_minutes ?? estimateMinutes(snapshot) : undefined,
  });

  let outcome: EmailOutcome;
  try {
    const { id } = await sendEmail({ to: req.to, subject, text, fromName: "Brian Rosenfelt", replyTo: "brian@rosably.com" });
    outcome = { sent: true, id };
  } catch (e) {
    outcome = e instanceof EmailError && e.code === "invalid_input"
      ? { sent: false, status: 400, error: "Enter a valid email address." }
      : { sent: false, status: 502, error: "The email couldn't be sent. Copy the invite instead." };
  }

  // Timeline entry either way. A logging failure doesn't undo a sent email.
  await crm.from("lead_activities").insert(outcome.sent
    ? {
        lead_id: invite.lead_id, activity_type: "email_sent", logged_by: "brian",
        email_subject: subject, email_direction: "sent",
        content: `Discovery questionnaire emailed to ${req.to}`,
        metadata: { discovery_invite_id: invite.id, gmail_message_id: outcome.id },
      }
    : {
        lead_id: invite.lead_id, activity_type: "system", logged_by: "brian",
        content: `Discovery questionnaire email to ${req.to} failed`,
        metadata: { discovery_invite_id: invite.id, gmail_message_id: null },
      },
  ).then(({ error }) => { if (error) console.error("discovery email: activity log failed", error.message); });

  return outcome;
}
