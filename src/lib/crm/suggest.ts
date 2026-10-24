// R17: suggest which existing contact an unmatched email's sender might be. Pure, no LLM.
// Must match v_freemail in crm.intake_lead (enforced by freemail.sql-sync.test.ts).
export const FREE_MAIL_DOMAINS = [
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com",
  "ymail.com", "rocketmail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me",
  "protonmail.com", "pm.me", "gmx.com", "gmx.net", "mail.com", "zoho.com", "zohomail.com",
  "fastmail.com", "hey.com", "yandex.com", "tutanota.com", "comcast.net", "verizon.net", "att.net",
  "sbcglobal.net", "cox.net", "charter.net", "earthlink.net"
] as const;

export type SuggestCandidate = { email: string; name?: string | null };
export type SuggestContact = { id: string; first_name: string | null; last_name: string | null; email: string | null };

export function emailDomain(email: string): string | null {
  const m = email.trim().toLowerCase().match(/^[^@\s]+@([^@\s]+)$/);
  return m ? m[1] : null;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const fullName = (c: SuggestContact) => norm([c.first_name, c.last_name].filter(Boolean).join(" "));

/** 1) exactly one contact on the candidate's (non-free-mail) domain; 2) exactly one full-name match; 3) null. */
export function suggestContact(candidate: SuggestCandidate, contacts: SuggestContact[]): string | null {
  const domain = emailDomain(candidate.email);
  if (domain && !(FREE_MAIL_DOMAINS as readonly string[]).includes(domain)) {
    const same = contacts.filter((c) => c.email && emailDomain(c.email) === domain);
    if (same.length === 1) return same[0].id;
  }
  const name = candidate.name ? norm(candidate.name) : "";
  if (name) {
    const hits = contacts.filter((c) => fullName(c) === name);
    if (hits.length === 1) return hits[0].id;
  }
  return null;
}
