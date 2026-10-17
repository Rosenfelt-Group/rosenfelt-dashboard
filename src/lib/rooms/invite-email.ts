// Plain-text invite email for a room link. Brian can copy it into his own mail client, or the
// access email route sends it via src/lib/email (Postmark, or Gmail as fallback).
export const DEFAULT_LINK_DAYS = 60;

export type RoomInviteEmail = { subject: string; body: string };

// "December 14, 2026" in the viewer's time zone (or the zone given, for tests); null if unusable.
function longDate(value: string | Date | null | undefined, timeZone?: string): string | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "long", day: "numeric", year: "numeric", ...(timeZone ? { timeZone } : {}),
    }).format(d);
  } catch {
    return null;
  }
}

export function roomInviteEmail(opts: {
  firstName?: string | null;
  orgName?: string | null;
  roomTitle: string;
  link: string;
  expiresAt?: string | Date | null;
  refreshed?: boolean;
  timeZone?: string;
}): RoomInviteEmail {
  const name = opts.firstName?.trim() || "there";
  const org = opts.orgName?.trim();
  const room = `the room for "${opts.roomTitle}"${org ? ` (${org})` : ""}`;
  const date = longDate(opts.expiresAt, opts.timeZone);
  const expiry = date ? `It expires on ${date}.` : `It expires in ${DEFAULT_LINK_DAYS} days.`;

  const intro = opts.refreshed
    ? `Here's a new link to ${room}. The old link no longer works, so please use this one from now on.`
    : `I've set up ${room}. It's a private page where you can look through the work we've shared and download any documents.`;
  const visit = opts.refreshed
    ? "If it asks for your name and email when you open it, that's expected."
    : "The first time you open it, you'll be asked for your name and email so I know who's looking.";

  return {
    subject: opts.refreshed ? `New link for "${opts.roomTitle}"` : `"${opts.roomTitle}" is ready for you to look at`,
    body: `Hi ${name},

${intro}

${opts.link}

${visit} The link is personal to you, so please don't share it publicly. ${expiry}

When you've had a look, just reply here with your thoughts.

Thanks,
Brian`,
  };
}
