export const MIN_SENDS_FOR_RATES = 50;
export const BOUNCE_WARN = 0.02;
export const BOUNCE_RED = 0.05;

export type HealthInput = {
  sent: number | null;
  delivered: number;
  unresolvedHardBounces: number;
  unresolvedSpam: number;
  bouncedTotal: number;
  eventsInWindow: number;
  postmarkError: "unreachable" | "auth" | null;
};

export type Health = {
  level: "green" | "amber" | "red";
  reasons: string[];
  bounceRate: number | null;
  deliveredPct: number | null;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function computeHealth(i: HealthInput): Health {
  const hasSends = i.sent !== null && i.sent > 0;
  const bounceRate = hasSends ? i.bouncedTotal / i.sent! : null;
  const deliveredPct = hasSends ? i.delivered / i.sent! : null;
  const ratesCount = hasSends && i.sent! >= MIN_SENDS_FOR_RATES;
  const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

  const red: string[] = [];
  const amber: string[] = [];

  if (i.postmarkError === "auth") red.push("Postmark rejected the token, so email status can't be checked");
  else if (i.postmarkError === "unreachable") red.push("Can't reach Postmark, so email status can't be checked");
  if (i.unresolvedSpam > 0) {
    red.push(
      i.unresolvedSpam === 1
        ? "A spam complaint needs attention"
        : `${i.unresolvedSpam} spam complaints need attention`,
    );
  }
  if (ratesCount && bounceRate! > BOUNCE_RED) {
    red.push(`${pct(bounceRate!)} of emails bounced this week (over 5%)`);
  }

  if (i.unresolvedHardBounces > 0) {
    amber.push(`${plural(i.unresolvedHardBounces, "email address", "email addresses")} can't be reached and needs attention`);
  }
  if (ratesCount && bounceRate! >= BOUNCE_WARN && bounceRate! <= BOUNCE_RED) {
    amber.push(`${pct(bounceRate!)} of emails bounced this week (2% or more)`);
  }
  if (hasSends && i.eventsInWindow === 0) {
    amber.push("Email alerts may be broken: no events from Postmark this week");
  }

  const level = red.length ? "red" : amber.length ? "amber" : "green";
  return { level, reasons: [...red, ...amber], bounceRate, deliveredPct };
}
