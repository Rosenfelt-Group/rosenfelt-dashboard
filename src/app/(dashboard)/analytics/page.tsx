"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type OverviewRow = { date: string; sessions: number; users: number; pageviews: number };
type SourceRow   = { channel: string; sessions: number };
type PageRow     = { path: string; title: string; pageviews: number; avgSessionDurationSec: number };
type EventRow    = { eventName: string; count: number };

type AnalyticsResponse = {
  overview: OverviewRow[];
  sources:  SourceRow[];
  pages:    PageRow[];
  events:   EventRow[];
  dateRange: { startDate: string; endDate: string };
};

type Preset = "7" | "30" | "90" | "custom";

const COLORS = {
  sessions:  "#C05621",
  users:     "#3B82F6",
  pageviews: "#10B981",
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function presetToRange(p: Preset, custom: { start: string; end: string }) {
  if (p === "7")  return { startDate: isoDaysAgo(6),  endDate: todayIso() };
  if (p === "30") return { startDate: isoDaysAgo(29), endDate: todayIso() };
  if (p === "90") return { startDate: isoDaysAgo(89), endDate: todayIso() };
  return { startDate: custom.start, endDate: custom.end };
}

function fmtMmDd(iso: string): string {
  if (iso.length < 10) return iso;
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
}

function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtNumber(n: number): string {
  return n.toLocaleString();
}

// ── Skeletons ────────────────────────────────────────────────────────────────

function CardSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div className="card animate-pulse">
      <div className="h-5 w-40 bg-brand-border rounded mb-4" />
      <div className="bg-brand-offwhite rounded" style={{ height }} />
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="card border-red-200 bg-red-50">
      <p className="text-sm font-medium text-red-800">Analytics error</p>
      <p className="text-sm text-red-700 mt-1">{message}</p>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [preset, setPreset]       = useState<Preset>("30");
  const [custom, setCustom]       = useState({ start: isoDaysAgo(29), end: todayIso() });
  const [data, setData]           = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  const range = useMemo(() => presetToRange(preset, custom), [preset, custom]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs  = new URLSearchParams({ startDate: range.startDate, endDate: range.endDate });
      const res = await fetch(`/api/analytics?${qs.toString()}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? `Request failed (${res.status})`);
        setData(null);
      } else {
        setData(body as AnalyticsResponse);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [range.startDate, range.endDate]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const rows = data?.overview ?? [];
    return rows.reduce(
      (acc, r) => ({
        sessions:  acc.sessions  + r.sessions,
        users:     acc.users     + r.users,
        pageviews: acc.pageviews + r.pageviews,
      }),
      { sessions: 0, users: 0, pageviews: 0 },
    );
  }, [data]);

  const overviewChartData = useMemo(
    () => (data?.overview ?? []).map(r => ({ ...r, label: fmtMmDd(r.date) })),
    [data],
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-brand-black">Analytics</h1>
          <p className="text-sm text-brand-muted mt-0.5">
            Google Analytics 4 · rosably.com
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(["7", "30", "90"] as const).map(p => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                preset === p
                  ? "bg-brand-orange text-white"
                  : "bg-white border border-brand-border text-brand-muted hover:text-brand-black",
              )}
            >
              Last {p} days
            </button>
          ))}

          <div className="flex items-center gap-1.5 pl-2 ml-1 border-l border-brand-border">
            <input
              type="date"
              value={custom.start}
              max={custom.end}
              onChange={e => { setCustom(c => ({ ...c, start: e.target.value })); setPreset("custom"); }}
              className="px-2 py-1.5 rounded-lg border border-brand-border text-sm text-brand-black bg-white"
            />
            <span className="text-brand-muted text-sm">to</span>
            <input
              type="date"
              value={custom.end}
              min={custom.start}
              max={todayIso()}
              onChange={e => { setCustom(c => ({ ...c, end: e.target.value })); setPreset("custom"); }}
              className="px-2 py-1.5 rounded-lg border border-brand-border text-sm text-brand-black bg-white"
            />
          </div>

          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white border border-brand-border text-brand-muted hover:text-brand-black disabled:opacity-50"
            title="Refresh"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Top-level error (config / network) */}
      {error && !loading && <ErrorCard message={error} />}

      {/* Section A — Traffic Overview */}
      {loading ? (
        <CardSkeleton height={300} />
      ) : data ? (
        <section className="card">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-4">
            <div>
              <h2 className="text-base font-semibold text-brand-black">Traffic Overview</h2>
              <p className="text-xs text-brand-muted mt-0.5">
                {data.dateRange.startDate} → {data.dateRange.endDate}
              </p>
            </div>
            <div className="flex gap-6">
              <Stat label="Sessions"  value={fmtNumber(totals.sessions)}  color={COLORS.sessions}  />
              <Stat label="Users"     value={fmtNumber(totals.users)}     color={COLORS.users}     />
              <Stat label="Pageviews" value={fmtNumber(totals.pageviews)} color={COLORS.pageviews} />
            </div>
          </div>

          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer>
              <LineChart data={overviewChartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid stroke="#E5E3DE" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#6B6B6E" fontSize={11} />
                <YAxis stroke="#6B6B6E" fontSize={11} />
                <Tooltip
                  contentStyle={{ background: "#fff", border: "1px solid #E5E3DE", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#1C1C1E", fontWeight: 600 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="sessions"  name="Sessions"  stroke={COLORS.sessions}  strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="users"     name="Users"     stroke={COLORS.users}     strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="pageviews" name="Pageviews" stroke={COLORS.pageviews} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      {/* Section B — Traffic Sources */}
      {loading ? (
        <CardSkeleton height={260} />
      ) : data ? (
        <section className="card">
          <h2 className="text-base font-semibold text-brand-black mb-1">Traffic Sources</h2>
          <p className="text-xs text-brand-muted mb-4">Sessions by channel</p>

          {data.sources.length === 0 ? (
            <p className="text-sm text-brand-muted py-12 text-center">No traffic in this range.</p>
          ) : (
            <div style={{ width: "100%", height: Math.max(220, data.sources.length * 36) }}>
              <ResponsiveContainer>
                <BarChart
                  data={data.sources}
                  layout="vertical"
                  margin={{ top: 8, right: 48, bottom: 8, left: 0 }}
                >
                  <CartesianGrid stroke="#E5E3DE" strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" stroke="#6B6B6E" fontSize={11} />
                  <YAxis
                    type="category"
                    dataKey="channel"
                    width={140}
                    stroke="#6B6B6E"
                    fontSize={11}
                    interval={0}
                  />
                  <Tooltip
                    contentStyle={{ background: "#fff", border: "1px solid #E5E3DE", borderRadius: 8, fontSize: 12 }}
                    cursor={{ fill: "#F0EEE9" }}
                  />
                  <Bar dataKey="sessions" fill={COLORS.sessions} radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="sessions" position="right" style={{ fill: "#1C1C1E", fontSize: 11 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      ) : null}

      {/* Section C — Top Pages */}
      {loading ? (
        <CardSkeleton height={300} />
      ) : data ? (
        <section className="card">
          <h2 className="text-base font-semibold text-brand-black mb-1">Top Pages</h2>
          <p className="text-xs text-brand-muted mb-4">By pageviews</p>

          {data.pages.length === 0 ? (
            <p className="text-sm text-brand-muted py-12 text-center">No pageviews in this range.</p>
          ) : (
            <div className="overflow-x-auto -mx-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-brand-muted text-xs uppercase tracking-wider">
                    <th className="px-5 py-2 font-semibold">Path</th>
                    <th className="px-5 py-2 font-semibold">Title</th>
                    <th className="px-5 py-2 font-semibold text-right">Pageviews</th>
                    <th className="px-5 py-2 font-semibold text-right">Avg. Session</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pages.map((p, i) => (
                    <tr
                      key={`${p.path}-${i}`}
                      className={clsx(i % 2 === 0 ? "bg-white" : "bg-brand-offwhite/60")}
                    >
                      <td className="px-5 py-2 max-w-xs truncate text-brand-black" title={p.path}>
                        <code className="text-xs">{p.path}</code>
                      </td>
                      <td className="px-5 py-2 max-w-sm truncate text-brand-muted" title={p.title}>
                        {p.title || "—"}
                      </td>
                      <td className="px-5 py-2 text-right text-brand-black tabular-nums">
                        {fmtNumber(p.pageviews)}
                      </td>
                      <td className="px-5 py-2 text-right text-brand-muted tabular-nums">
                        {fmtDuration(p.avgSessionDurationSec)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {/* Section D — Top Events */}
      {loading ? (
        <CardSkeleton height={300} />
      ) : data ? (
        <section className="card">
          <h2 className="text-base font-semibold text-brand-black mb-1">Top Events</h2>
          <p className="text-xs text-brand-muted mb-4">Most-fired events (filtered)</p>

          {data.events.length === 0 ? (
            <p className="text-sm text-brand-muted py-12 text-center">No events in this range.</p>
          ) : (
            <div className="overflow-x-auto -mx-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-brand-muted text-xs uppercase tracking-wider">
                    <th className="px-5 py-2 font-semibold">Event</th>
                    <th className="px-5 py-2 font-semibold text-right">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((e, i) => (
                    <tr
                      key={`${e.eventName}-${i}`}
                      className={clsx(i % 2 === 0 ? "bg-white" : "bg-brand-offwhite/60")}
                    >
                      <td className="px-5 py-2 text-brand-black">
                        <code className="text-xs">{e.eventName}</code>
                      </td>
                      <td className="px-5 py-2 text-right text-brand-black tabular-nums">
                        {fmtNumber(e.count)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-brand-muted mt-3">
            Conversion events not yet configured in GA4. These are the most-fired events on the site
            (internal events <code className="text-[10px]">session_start</code>,{" "}
            <code className="text-[10px]">first_visit</code>,{" "}
            <code className="text-[10px]">user_engagement</code>,{" "}
            <code className="text-[10px]">scroll</code>,{" "}
            <code className="text-[10px]">click</code>, and{" "}
            <code className="text-[10px]">page_view</code> are filtered out).
          </p>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-brand-muted">{label}</span>
      <span className="text-lg font-semibold text-brand-black tabular-nums" style={{ color }}>
        {value}
      </span>
    </div>
  );
}
