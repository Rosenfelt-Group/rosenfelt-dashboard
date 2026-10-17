import { sendEmail as sendViaGmail, isEmailConfigured as isGmailConfigured, type SendEmailInput } from "./gmail";
import { sendViaPostmark, isPostmarkConfigured } from "./postmark";

// Server-only entry point for app email. Postmark is the provider when POSTMARK_SERVER_TOKEN and
// POSTMARK_SENDER are set; otherwise it falls back to the Gmail API mailer.
export { EmailError, isValidEmail, type SendEmailInput, type EmailErrorCode } from "./gmail";

export function emailProvider(): "postmark" | "gmail" | null {
  if (isPostmarkConfigured()) return "postmark";
  if (isGmailConfigured()) return "gmail";
  return null;
}

export function isEmailConfigured(): boolean {
  return emailProvider() !== null;
}

export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  return emailProvider() === "postmark" ? sendViaPostmark(input) : sendViaGmail(input);
}
