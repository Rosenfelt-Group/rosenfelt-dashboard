"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";

type Lead = {
  id: string;
  created_at: string;
  name: string;
  email: string;
  org: string;
  org_type: string;
  snapshot: string | null;
  token: string | null;
};

type FunnelStep = {
  name: string;
  count: number;
  dropoff: number | null;
};

type FunnelData = {
  steps: FunnelStep[];
  dateRange: { startDate: string; endDate: string };
};

const STEP_LABELS: Record<string, string> = {
  quiz_start:         "Quiz start",
  quiz_gate:          "Gate reached",
  generate_snapshot:  "Snapshot requested",
  snapshot_generated: "Snapshot shown",
  checkout_click:     "Checkout click",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function snapshotUrl(token: string) {
  return `https://rosably.com/wp-content/uploads/snapshot.html?token=${token}`;
}

export default function QuizPage() {
  const [leads,      setLeads]      = useState<Lead[]>([]);
  const [funnel,     setFunnel]     = useState<FunnelData | null>(null);
  const [leadsErr,   setLeadsErr]   = useState("");
  const [funnelErr,  setFunnelErr]  = useState("");
  const [loading,    setLoading]    = useState(true);
  const [copied,     setCopied]     = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/quiz-leads").then(r => r.json()),
      fetch("/api/quiz-funnel").then(r => r.json()),
    ]).then(([ld, fn]) => {
      if (Array.isArray(ld)) setLeads(ld);
      else setLeadsErr(ld?.error ?? "Failed to load leads");

      if (fn?.steps) setFunnel(fn);
      else setFunnelErr(fn?.error ?? "Failed to load funnel data");

      setLoading(false);
    }).catch(() => { setLoading(false); setLeadsErr("Network error"); });
  }, []);

  function copyLink(token: string) {
    navigator.clipboard.writeText(snapshotUrl(token)).then(() => {
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const topCount = funnel?.steps[0]?.count ?? 0;

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-brand-black">Quiz Analytics</h1>
        <p className="text-sm text-brand-muted mt-0.5">Assessment leads + funnel conversion · rolling 30 days</p>
      </div>

      {/* ── Funnel ─────────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-brand-black mb-3">Funnel</h2>
        {loading ? (
          <div className="card animate-pulse h-32" />
        ) : funnelErr ? (
          <div className="card p-4 text-sm text-red-600">{funnelErr}</div>
        ) : funnel && (
          <div className="card divide-y divide-brand-border">
            {funnel.steps.map((step, i) => {
              const pct = topCount > 0 ? Math.round((step.count / topCount) * 100) : 0;
              return (
                <div key={step.name} className="flex items-center gap-4 px-4 py-3">
                  <span className="w-5 text-xs font-medium text-brand-muted shrink-0">{i + 1}</span>
                  <span className="w-40 text-sm text-brand-black shrink-0">
                    {STEP_LABELS[step.name] ?? step.name}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="h-2 rounded-full bg-brand-offwhite overflow-hidden">
                      <div
                        className="h-full rounded-full bg-brand-orange transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <span className="w-12 text-right text-sm font-medium text-brand-black shrink-0">
                    {step.count.toLocaleString()}
                  </span>
                  <span className={clsx(
                    "w-16 text-right text-xs shrink-0",
                    step.dropoff !== null && step.dropoff > 50 ? "text-red-500" : "text-brand-muted"
                  )}>
                    {step.dropoff !== null ? `−${step.dropoff}%` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Leads table ────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-brand-black mb-3">
          Leads
          {leads.length > 0 && <span className="ml-2 text-brand-muted font-normal">{leads.length}</span>}
        </h2>
        {loading ? (
          <div className="card animate-pulse h-48" />
        ) : leadsErr ? (
          <div className="card p-4 text-sm text-red-600">{leadsErr}</div>
        ) : leads.length === 0 ? (
          <div className="card p-6 text-sm text-brand-muted text-center">No leads yet.</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-border text-xs text-brand-muted font-medium">
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Org</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Type</th>
                  <th className="text-left px-4 py-3 hidden lg:table-cell">Date</th>
                  <th className="text-left px-4 py-3">Snapshot</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {leads.map(lead => (
                  <tr key={lead.id} className="hover:bg-brand-offwhite transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-brand-black">{lead.name}</div>
                      <div className="text-xs text-brand-muted">{lead.email}</div>
                    </td>
                    <td className="px-4 py-3 text-brand-black">{lead.org}</td>
                    <td className="px-4 py-3 text-brand-muted hidden md:table-cell">{lead.org_type}</td>
                    <td className="px-4 py-3 text-brand-muted hidden lg:table-cell whitespace-nowrap">
                      {fmt(lead.created_at)}
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      {lead.snapshot ? (
                        <span className="text-brand-muted line-clamp-2 text-xs">
                          {lead.snapshot.slice(0, 100)}{lead.snapshot.length > 100 ? "…" : ""}
                        </span>
                      ) : (
                        <span className="text-xs text-brand-muted italic">No snapshot</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {lead.token && (
                        <div className="flex items-center justify-end gap-2">
                          <a
                            href={snapshotUrl(lead.token)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-brand-orange hover:underline"
                          >
                            View
                          </a>
                          <button
                            onClick={() => copyLink(lead.token!)}
                            className="text-xs text-brand-muted hover:text-brand-black transition-colors"
                            title="Copy snapshot link"
                          >
                            {copied === lead.token ? "Copied!" : "Copy link"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
