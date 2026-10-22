/** R38: the Approvals "Send" action shows only for approved email_send rows that were never executed. */
export function canSendApproval(a: { action_type: string; status: string; executed_at?: string | null }): boolean {
  return a.action_type === "email_send" && a.status === "approved" && !a.executed_at;
}

export const SKIPPED_MESSAGE = "Not sent: this approval was already executed or is not approved.";

/** Text for a failed/skipped execute call: body is the parsed JSON response of POST /api/approvals/:id/execute. */
export function executeFailureMessage(body: { status?: string; error?: string } | null | undefined, httpStatus: number): string {
  if (body?.status === "skipped") return SKIPPED_MESSAGE;
  return `Email NOT sent: ${body?.error ?? body?.status ?? `HTTP ${httpStatus}`}`;
}
