/** R38: the Approvals "Send" action shows only for approved email_send rows that were never executed. */
export function canSendApproval(a: { action_type: string; status: string; executed_at?: string | null }): boolean {
  return a.action_type === "email_send" && a.status === "approved" && !a.executed_at;
}
