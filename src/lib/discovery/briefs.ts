import { supabaseAdmin } from "@/lib/supabase-admin";
import { requestBrief, RileyNotConfiguredError, type BriefResponse, type RileyResult } from "@/lib/riley/discovery";

/** Mark the invite's pending brief failed (Riley never got to; when Riley itself fails it marks the row). */
export async function failPendingBrief(inviteId: string, error: string): Promise<void> {
  await supabaseAdmin.schema("crm").from("discovery_briefs")
    .update({ status: "failed", error, completed_at: new Date().toISOString() })
    .eq("invite_id", inviteId).eq("status", "pending");
}

/**
 * Ask Riley to generate the brief (synchronous, R65). When Riley cannot be reached, or is not configured,
 * the pending brief is marked failed here because Riley never saw it. Not-configured is re-thrown.
 */
export async function runBrief(inviteId: string): Promise<RileyResult<BriefResponse>> {
  try {
    const r = await requestBrief(inviteId);
    if (!r.ok && r.kind === "unreachable") await failPendingBrief(inviteId, "Riley unreachable");
    return r;
  } catch (e) {
    if (e instanceof RileyNotConfiguredError) await failPendingBrief(inviteId, "Riley not configured");
    throw e;
  }
}
