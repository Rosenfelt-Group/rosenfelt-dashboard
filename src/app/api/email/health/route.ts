import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
import { EmailError } from "@/lib/email/gmail";
import { emailProvider } from "@/lib/email";
import { getOutboundStats, KNOWN_TAGS } from "@/lib/email/postmark-api";
import { listProblems, windowCounts } from "@/lib/email/events";
import { computeHealth } from "@/lib/email/health";

const DAY_MS = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

// "dashboard-room-invite" -> "dashboard"; "wordpress" -> "wordpress"
const sourceOf = (tag: string) => tag.split("-")[0];

// GET — everything the Email health card needs, in one call. A Postmark outage degrades to
// stats:null + a red health level; it never turns into a 5xx.
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "view_overview");
  if (!auth.ok) return auth.response;
  const canManage = (await requirePermission(req, "manage_email")).ok;
  // Resend sends through Postmark only (the resend route answers 503 otherwise), so the UI hides it until then.
  const canResend = canManage && emailProvider() === "postmark";

  const includeResolved = req.nextUrl.searchParams.get("includeResolved") === "1";
  const now = new Date();
  const sinceDate = new Date(now.getTime() - 7 * DAY_MS);
  const since = sinceDate.toISOString();
  const window = { from: ymd(sinceDate), to: ymd(now) };

  let postmarkError: "unreachable" | "auth" | null = null;
  let stats: { sent: number; bounced: number; spamComplaints: number } | null = null;
  let bySource: { source: string; sent: number; bounced: number; spam: number }[] = [];
  try {
    const [total, perTag] = await Promise.all([
      getOutboundStats(window.from, window.to),
      Promise.all(KNOWN_TAGS.map(async (tag) => ({ tag, s: await getOutboundStats(window.from, window.to, tag) }))),
    ]);
    stats = total;
    const groups = new Map<string, { source: string; sent: number; bounced: number; spam: number }>();
    for (const { tag, s } of perTag) {
      const source = sourceOf(tag);
      const g = groups.get(source) ?? { source, sent: 0, bounced: 0, spam: 0 };
      g.sent += s.sent; g.bounced += s.bounced; g.spam += s.spamComplaints;
      groups.set(source, g);
    }
    // Untagged mail (e.g. avery/weekly-audit sent over SMTP) and unknown tags: whatever the tagged rows don't cover.
    const tagged = [...groups.values()];
    const rest = (k: "sent" | "bounced" | "spam", all: number) => Math.max(0, all - tagged.reduce((n, g) => n + g[k], 0));
    bySource = [...tagged, {
      source: "other", sent: rest("sent", total.sent), bounced: rest("bounced", total.bounced), spam: rest("spam", total.spamComplaints),
    }];
  } catch (e) {
    postmarkError = e instanceof EmailError && e.code === "auth_failed" ? "auth" : "unreachable";
    stats = null;
    bySource = [];
  }

  try {
    const [counts, problems] = await Promise.all([windowCounts(since), listProblems({ since, includeResolved })]);
    const health = computeHealth({
      sent: stats?.sent ?? null,
      delivered: counts.delivered,
      unresolvedHardBounces: counts.unresolvedHardBounces,
      unresolvedSpam: counts.unresolvedSpam,
      bouncedTotal: stats?.bounced ?? 0,
      eventsInWindow: counts.events,
      postmarkError,
    });
    return NextResponse.json({
      health, window, stats, bySource, problems, lastProblem: problems.find((p) => !p.resolved_at) ?? null,
      canManage, canResend,
    });
  } catch (e) {
    console.error("email health: events store failed:", e);
    return NextResponse.json({ error: "Could not load email events" }, { status: 500 });
  }
}
