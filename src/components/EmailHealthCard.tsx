"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { EmailProblem } from "@/lib/email/events";
import { usePolling } from "@/lib/use-polling";
import { fetchJson } from "@/lib/fetch-json";
import { lastProblemText } from "@/components/status/tabs/helpers";

export type EmailHealthResponse = {
  health: {
    level: "green" | "amber" | "red";
    reasons: string[];
    bounceRate: number | null;
    deliveredPct: number | null;
  };
  window: { from: string; to: string };
  stats: { sent: number; bounced: number; spamComplaints: number } | null;
  bySource: { source: string; sent: number; bounced: number; spam: number }[];
  problems: EmailProblem[];
  lastProblem: EmailProblem | null;
  canManage: boolean;
  /** canManage and the server sends through Postmark; otherwise the resend route would refuse (503). */
  canResend: boolean;
};

export const HEALTH_LEVELS = {
  green: { word: "Healthy", dot: "bg-green-500", text: "text-green-700" },
  amber: { word: "Needs attention", dot: "bg-amber-400", text: "text-amber-700" },
  red: { word: "Problem", dot: "bg-red-500", text: "text-red-700" },
} as const;

export function EmailHealthCard() {
  const [data, setData] = useState<EmailHealthResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const res = await fetchJson<EmailHealthResponse>("/api/email/health");
    if (res.ok) { setData(res.data); setFailed(false); }
    else setFailed(true);
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load]);
  usePolling(load, 60_000);

  if (!loaded) return <div className="card animate-pulse h-16 mb-6" aria-busy="true" />;

  return (
    <div className="card mb-6 !p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-brand-black">Email</h2>
        <Link href="/status?tab=email" className="text-xs text-brand-orange hover:underline shrink-0">Details →</Link>
      </div>
      {failed && !data ? (
        <p className="text-sm text-brand-muted mt-1">Email status unavailable</p>
      ) : data && (
        <div className="mt-1 space-y-1">
          <p className="flex items-center gap-2 text-sm flex-wrap">
            <span className={clsx("w-2.5 h-2.5 rounded-full shrink-0", HEALTH_LEVELS[data.health.level].dot)} />
            <span className={clsx("font-medium", HEALTH_LEVELS[data.health.level].text)}>
              {HEALTH_LEVELS[data.health.level].word}
            </span>
            {data.health.level !== "green" && data.health.reasons[0] && (
              <span className="text-brand-muted">{data.health.reasons[0]}</span>
            )}
          </p>
          <p className="text-xs text-brand-muted">
            {data.stats
              ? `${data.stats.sent} sent · ${data.stats.bounced} bounces · ${data.stats.spamComplaints} spam (7 days)`
              : "Send counts unavailable"}
          </p>
          {data.lastProblem && (
            <p className="text-xs text-brand-muted">Last problem: {lastProblemText(data.lastProblem)}</p>
          )}
        </div>
      )}
    </div>
  );
}
