export function reSubject(subject: string | null | undefined): string {
  const s = (subject ?? "").trim();
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export type ReplySource = { id: string; direction: "received" | "sent"; from_email: string | null; to_emails: string[]; subject: string | null };

/** Prefill for replying to a timeline email: To is the original sender (or the recipients of a message Brian sent). */
export function replyDefaults(m: ReplySource): { reply_to_email_message_id: string; to: string[]; subject: string } {
  const to = m.direction === "received" ? (m.from_email ? [m.from_email] : []) : m.to_emails;
  return { reply_to_email_message_id: m.id, to, subject: reSubject(m.subject) };
}
