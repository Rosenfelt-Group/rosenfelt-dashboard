"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { fetchJson } from "@/lib/fetch-json";
import { usePolling } from "@/lib/use-polling";
import { addDays, money } from "@/lib/crm/pipeline";
import type { TodayItem, TodayItemType, TodayResponse, TodaySeverity } from "@/lib/crm/today-queue";
import { StatCard } from "@/components/StatCard";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/ui";

const TYPE_LABELS: Record<TodayItemType, string> = {
  next_step: "Next step", scope: "Scope", brief: "Brief", questionnaire: "Follow-up", inbox: "Inbox",
  duplicate: "Duplicate", room: "Room", existing_client: "Client signup",
};
const ACTION_LABELS: Record<TodayItemType, string> = {
  next_step: "Open deal", scope: "Review", brief: "Read brief", questionnaire: "Open", inbox: "Sort",
  duplicate: "Review", room: "Open room", existing_client: "Open organization",
};
const SEVERITY_BADGE: Record<TodaySeverity, string> = {
  high: "bg-amber-50 text-amber-700",
  medium: "bg-orange-50 text-brand-orange",
  low: "bg-gray-100 text-gray-600",
};

function greeting(d = new Date()) {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }).format(d));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function CRMTodayPage() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [me, setMe] = useState<{ username?: string; role?: string; permissions?: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetchJson<TodayResponse>("/api/crm/today");
    if (r.ok) { setData(r.data); setLoadError(null); }
    else setLoadError(r.error);
  }, []);

  useEffect(() => {
    load();
    fetchJson<{ username?: string; role?: string; permissions?: string[] }>("/api/auth/me").then(r => { if (r.ok) setMe(r.data); });
  }, [load]);
  usePolling(load, 60_000);

  const canManage = me?.role === "admin" || !!me?.permissions?.includes("manage_crm");

  async function updateNextStep(item: TodayItem, body: Record<string, unknown>) {
    if (!item.lead_id) return;
    setBusy(item.id);
    setActionError(null);
    const r = await fetchJson(`/api/crm/leads/${item.lead_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) setActionError(`Couldn't update the next step: ${r.error}`);
    else setData(d => d && { ...d, items: d.items.filter(i => i.id !== item.id) });
    setBusy(null);
    load();
  }

  const name = me?.username ? me.username.charAt(0).toUpperCase() + me.username.slice(1) : null;
  const overdue = data?.items.filter(i => i.severity === "high").length ?? 0;
  const maxStage = Math.max(1, ...(data?.by_stage.map(s => s.value) ?? [0]));

  return (
    <div className="p-4 md:p-8 pb-24 md:pb-8">
      <PageHeader
        title={`${greeting()}${name ? `, ${name}` : ""}`}
        description={data
          ? data.items.length
            ? `${data.items.length} ${data.items.length === 1 ? "thing needs" : "things need"} you today${overdue ? ` · ${overdue} overdue` : ""}`
            : "Nothing needs you right now"
          : undefined}
      />

      {!data && !loadError ? (
        <LoadingState />
      ) : !data ? (
        <ErrorState message={`Couldn't load Today: ${loadError}`} onRetry={load} />
      ) : (
        <>
          {loadError && <ErrorState message={`Refresh failed: ${loadError}`} onRetry={load} className="mb-4" />}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="Open pipeline" value={money(data.kpis.open_pipeline.value)} sub={`${data.kpis.open_pipeline.count} ${data.kpis.open_pipeline.count === 1 ? "deal" : "deals"}`} />
            <StatCard
              label="Active clients"
              value={data.kpis.active_clients.count}
              sub={[
                data.kpis.active_clients.contracted_monthly ? `${money(data.kpis.active_clients.contracted_monthly)}/mo` : null,
                data.kpis.active_clients.contracted_project ? `${money(data.kpis.active_clients.contracted_project)} project` : null,
              ].filter(Boolean).join(" + ") || "nothing contracted"}
            />
            <StatCard label="Hours this month" value={data.kpis.hours_this_month} sub="time & materials" />
            <StatCard label="Waiting on prospects" value={data.kpis.questionnaires_out} sub="questionnaires out" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card lg:col-span-2">
              <h2 className="text-sm font-medium text-brand-black mb-3">
                Needs you <span className="text-brand-muted font-normal">{data.items.length}</span>
              </h2>
              {actionError && <p role="alert" className="text-xs text-red-600 mb-2">{actionError}</p>}
              {data.items.length === 0 ? (
                <EmptyState title="You're all caught up." className="shadow-none border-0" />
              ) : (
                <ul className="divide-y divide-brand-border">
                  {data.items.map(item => (
                    <li key={item.id} className="py-3 flex flex-wrap items-start gap-3">
                      <span className={clsx("badge text-xs shrink-0 mt-0.5", SEVERITY_BADGE[item.severity])}>{TYPE_LABELS[item.type]}</span>
                      <div className="min-w-0 flex-1 basis-48">
                        <p className="text-sm font-medium text-brand-black break-words">{item.title}</p>
                        <p className={clsx("text-xs mt-0.5 break-words", item.severity === "high" ? "text-amber-600" : "text-brand-muted")}>
                          {item.subtitle}
                          {item.at && item.type !== "next_step" && ` · ${formatDistanceToNow(new Date(item.at), { addSuffix: true })}`}
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Link
                          href={item.link}
                          className="inline-flex items-center rounded-lg font-medium px-3 py-1.5 text-xs bg-brand-orange text-white hover:bg-brand-orange-dark"
                        >
                          {ACTION_LABELS[item.type]}
                        </Link>
                        {item.type === "next_step" && canManage && (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={busy === item.id}
                              onClick={() => updateNextStep(item, { next_step_due: addDays(data.today, 1) })}
                              title="Move the due date to tomorrow"
                            >
                              Snooze
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy === item.id}
                              onClick={() => updateNextStep(item, { next_step: null, next_step_due: null })}
                              title="Clear this next step"
                            >
                              Done
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card">
              <h2 className="text-sm font-medium text-brand-black mb-3">Pipeline by stage</h2>
              <div className="space-y-2.5">
                {data.by_stage.map(s => (
                  <div key={s.stage} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-xs">
                    <span className="text-brand-black truncate">
                      {s.label} <span className="text-brand-muted">· {s.count}</span>
                    </span>
                    <div className="h-1.5 rounded-full bg-brand-border overflow-hidden">
                      <div className="h-full bg-brand-orange rounded-full" style={{ width: `${Math.round((s.value / maxStage) * 100)}%` }} />
                    </div>
                    <span className="text-brand-muted text-right tabular-nums">{s.value ? money(s.value) : "—"}</span>
                  </div>
                ))}
              </div>
              <Link href="/crm" className="text-xs text-brand-orange hover:underline mt-4 inline-block">Open pipeline →</Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
