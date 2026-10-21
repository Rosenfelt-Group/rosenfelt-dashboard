import type { PendingApproval } from "@/types";

/** email_send rows are approved and sent only from the Approvals page (approve, then execute). */
export const isEmailSend = (a: Pick<PendingApproval, "action_type">) => a.action_type === "email_send";
export const withoutEmailSend = <T extends Pick<PendingApproval, "action_type">>(xs: T[]): T[] => xs.filter((a) => !isEmailSend(a));
