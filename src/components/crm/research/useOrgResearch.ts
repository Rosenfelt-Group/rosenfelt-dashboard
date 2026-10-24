"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import type { LinkedBrief, OrgResearch, OrgResearchNote, ResearchItemType } from "@/lib/research/types";

export type ResearchItem = OrgResearchNote | LinkedBrief;

/** Loads an organization's research and saves "Use in scope" ticks (optimistic, reverted on failure). */
export function useOrgResearch(businessId: string) {
  const [data, setData] = useState<OrgResearch | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetchJson<OrgResearch>(`/api/crm/businesses/${businessId}/research`);
    if (r.ok && r.data && Array.isArray(r.data.notes)) { setData(r.data); setLoadError(null); }
    else setLoadError(r.ok ? "Unexpected response" : r.error);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const toggle = useCallback(async (type: ResearchItemType, id: string, selected: boolean) => {
    setSaveError(null);
    const flip = (d: OrgResearch, on: boolean): OrgResearch => {
      const notes = d.notes.map(n => (type === "note" && n.id === id ? { ...n, selected: on } : n));
      const briefs = d.briefs.map(b => (type === "brief" && b.id === id ? { ...b, selected: on } : b));
      return { ...d, notes, briefs, selected_count: notes.filter(n => n.selected).length + briefs.filter(b => b.selected).length };
    };
    setData(d => (d ? flip(d, selected) : d));
    const r = await fetchJson<OrgResearch>(`/api/crm/businesses/${businessId}/research-inputs`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ type, id, selected }] }),
    });
    if (r.ok && r.data && Array.isArray(r.data.notes)) setData(r.data);
    else { setData(d => (d ? flip(d, !selected) : d)); setSaveError(r.ok ? "Couldn't save" : r.error); }
  }, [businessId]);

  return { data, loadError, saveError, load, toggle };
}

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

const TYPE_LABEL: Record<string, string> = { competitor: "Competitor", tool: "Tool", trend: "Trend", business: "Organization" };

export function itemTitle(it: ResearchItem): string {
  if (it.type === "brief") return it.topic;
  const t = it.details && typeof it.details.title === "string" ? it.details.title : "";
  return t || it.summary || "Note";
}

export function itemSource(it: ResearchItem): string {
  if (it.type === "brief") return ["Library", TYPE_LABEL[it.research_type] ?? it.research_type, fmtDate(it.created_at)].filter(Boolean).join(" · ");
  const who = it.researched_by === "avery" ? "Avery" : it.source === "manual" ? `Note by ${it.researched_by ?? "you"}` : (it.researched_by ?? "Note");
  return `${who} · ${fmtDate(it.created_at)}`;
}

export { fmtDate, TYPE_LABEL };
