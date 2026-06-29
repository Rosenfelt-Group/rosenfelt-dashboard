"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import AddDirectoryModal from "./AddDirectoryModal";

interface Directory {
  id: string; name: string; url: string; priority_tier: string;
  cost: string | null; complexity: string | null; status: string;
  date_completed: string | null; notes: string | null;
  is_candidate: boolean; source: string;
}

const STATUS_OPTIONS = ["Not Started", "In Progress", "Submitted", "Live", "Skipped"];
const PRIORITY_FILTERS = ["All", "Submit Now", "Submit Soon", "Low Priority"];
const STATUS_FILTERS = ["All", "Not Started", "In Progress", "Submitted", "Live", "Skipped"];

const STATUS_COLORS: Record<string, string> = {
  "Live":        "bg-green-100 text-green-700",
  "Submitted":   "bg-blue-100 text-blue-700",
  "In Progress": "bg-amber-100 text-amber-700",
  "Skipped":     "bg-gray-100 text-gray-500",
  "Not Started": "bg-brand-offwhite text-brand-muted",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx("inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium",
      STATUS_COLORS[status] ?? "bg-brand-offwhite text-brand-muted")}>
      {status}
    </span>
  );
}

function toHref(url: string): string {
  return url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`;
}

function DirectoryRow({ dir, onUpdate, onDelete }: {
  dir: Directory;
  onUpdate: (id: string, patch: Partial<Directory>) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editingStatus, setEditingStatus] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(dir.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function patchStatus(status: string) {
    setSaving(true);
    const date_completed = ["Live", "Submitted", "Skipped"].includes(status)
      ? (dir.date_completed ?? new Date().toISOString().slice(0, 10))
      : dir.date_completed;
    await onUpdate(dir.id, { status, date_completed });
    setSaving(false);
    setEditingStatus(false);
  }

  async function saveNotes() {
    setSaving(true);
    await onUpdate(dir.id, { notes });
    setSaving(false);
    setEditingNotes(false);
  }

  async function approveCandidate() {
    setSaving(true);
    await onUpdate(dir.id, { is_candidate: false });
    setSaving(false);
  }

  return (
    <tr className={clsx(
      "border-b border-brand-border/50 hover:bg-brand-offwhite/50 transition-colors",
      dir.is_candidate && "bg-brand-orange/5 border-l-2 border-l-brand-orange"
    )}>
      {/* Name + URL */}
      <td className="px-3 py-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-brand-black">{dir.name}</span>
          <a href={toHref(dir.url)} target="_blank" rel="noopener noreferrer"
            className="text-[11px] text-brand-orange hover:underline"
            onClick={e => e.stopPropagation()}>
            {dir.url} ↗
          </a>
          {dir.is_candidate && (
            <span className="text-[10px] text-brand-orange font-medium">Avery suggestion — pending review</span>
          )}
        </div>
      </td>
      {/* Priority */}
      <td className="px-3 py-2.5 text-xs text-brand-muted whitespace-nowrap">{dir.priority_tier}</td>
      {/* Cost */}
      <td className="px-3 py-2.5 text-xs text-brand-muted">{dir.cost ?? "—"}</td>
      {/* Complexity */}
      <td className="px-3 py-2.5 text-xs text-brand-muted">{dir.complexity ?? "—"}</td>
      {/* Status — inline dropdown */}
      <td className="px-3 py-2.5">
        {editingStatus ? (
          <select
            autoFocus
            defaultValue={dir.status}
            disabled={saving}
            onChange={e => { if (e.target.value !== dir.status) patchStatus(e.target.value); }}
            onBlur={() => setEditingStatus(false)}
            className="text-xs border border-brand-orange rounded px-1.5 py-1 focus:outline-none"
          >
            {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
          </select>
        ) : (
          <button onClick={() => setEditingStatus(true)} title="Click to change status">
            <StatusBadge status={dir.status} />
          </button>
        )}
      </td>
      {/* Date */}
      <td className="px-3 py-2.5 text-xs text-brand-muted whitespace-nowrap">
        {dir.date_completed
          ? new Date(dir.date_completed + "T00:00:00").toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" })
          : "—"}
      </td>
      {/* Notes — inline edit */}
      <td className="px-3 py-2.5 text-xs text-brand-muted max-w-[220px]">
        {editingNotes ? (
          <div className="flex gap-1">
            <textarea
              autoFocus
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="text-xs border border-brand-orange rounded px-1.5 py-1 w-full resize-none focus:outline-none"
            />
            <div className="flex flex-col gap-1">
              <button onClick={saveNotes} disabled={saving}
                className="text-[10px] text-green-700 hover:text-green-900 font-medium">Save</button>
              <button onClick={() => { setNotes(dir.notes ?? ""); setEditingNotes(false); }}
                className="text-[10px] text-brand-muted hover:text-brand-black">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setEditingNotes(true)} title="Click to edit notes"
            className="text-left truncate max-w-[200px] hover:text-brand-black transition-colors">
            {dir.notes || <span className="italic text-brand-muted/50">add note</span>}
          </button>
        )}
      </td>
      {/* Actions */}
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          {dir.is_candidate && (
            <button onClick={approveCandidate} disabled={saving}
              className="text-[11px] px-2 py-0.5 rounded bg-brand-orange/10 text-brand-orange hover:bg-brand-orange/20 font-medium transition-colors">
              Approve
            </button>
          )}
          <button
            onClick={() => onDelete(dir.id)}
            className="text-[11px] text-brand-muted hover:text-red-600 transition-colors"
            title="Delete"
          >
            ✕
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function DirectoriesTab() {
  const [dirs, setDirs] = useState<Directory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showAdd, setShowAdd] = useState(false);
  const [researching, setResearching] = useState(false);
  const [researchMsg, setResearchMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/marketing/directories");
      if (!res.ok) {
        setError("Failed to load directories");
        return;
      }
      const data = await res.json();
      setDirs(Array.isArray(data) ? data : []);
      setError(null);
    } catch {
      setError("Failed to load directories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUpdate = useCallback(async (id: string, patch: Partial<Directory>): Promise<boolean> => {
    const res = await fetch(`/api/marketing/directories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const updated = await res.json();
    if (res.ok) {
      setDirs(prev => prev.map(d => d.id === id ? { ...d, ...updated } : d));
      return true;
    }
    setError(updated.error ?? "Failed to save — please try again");
    return false;
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Mark this directory as Skipped? It won't be suggested by Avery again.")) return;
    const res = await fetch(`/api/marketing/directories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Skipped" }),
    });
    const updated = await res.json();
    if (res.ok) setDirs(prev => prev.map(d => d.id === id ? { ...d, ...updated } : d));
  }, []);

  async function handleResearch() {
    setResearching(true);
    setResearchMsg(null);
    try {
      const res = await fetch("/api/marketing/directories/research", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setResearchMsg(`Avery found ${data.added} new candidate${data.added !== 1 ? "s" : ""}. Check the list for orange rows.`);
        await load();
      } else {
        setResearchMsg(data.error ?? "Research failed");
      }
    } catch {
      setResearchMsg("Network error");
    } finally {
      setResearching(false);
    }
  }

  const filtered = dirs.filter(d => {
    if (priorityFilter !== "All" && d.priority_tier !== priorityFilter) return false;
    if (statusFilter !== "All" && d.status !== statusFilter) return false;
    return true;
  });

  // Summary counts
  const live = dirs.filter(d => d.status === "Live").length;
  const submitted = dirs.filter(d => d.status === "Submitted").length;
  const inProgress = dirs.filter(d => d.status === "In Progress").length;
  const notStarted = dirs.filter(d => d.status === "Not Started").length;
  const candidates = dirs.filter(d => d.is_candidate).length;

  return (
    <div className="space-y-4">
      {/* Summary pills */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: "Live", count: live, color: "bg-green-100 text-green-700" },
          { label: "Submitted", count: submitted, color: "bg-blue-100 text-blue-700" },
          { label: "In Progress", count: inProgress, color: "bg-amber-100 text-amber-700" },
          { label: "Not Started", count: notStarted, color: "bg-brand-offwhite text-brand-muted" },
          ...(candidates > 0 ? [{ label: "Avery Candidates", count: candidates, color: "bg-brand-orange/10 text-brand-orange" }] : []),
        ].map(s => (
          <span key={s.label} className={clsx("text-xs px-2.5 py-1 rounded-full font-medium", s.color)}>
            {s.count} {s.label}
          </span>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex gap-2 flex-wrap">
          <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
            className="text-xs border border-brand-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-brand-orange bg-white">
            {PRIORITY_FILTERS.map(f => <option key={f}>{f}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="text-xs border border-brand-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-brand-orange bg-white">
            {STATUS_FILTERS.map(f => <option key={f}>{f}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <button onClick={handleResearch} disabled={researching}
            className={clsx("px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
              researching
                ? "bg-brand-offwhite text-brand-muted border-brand-border cursor-not-allowed"
                : "bg-white border-brand-border text-brand-muted hover:bg-brand-offwhite hover:text-brand-black")}>
            {researching ? "Researching…" : "Research with Avery"}
          </button>
          <button onClick={() => setShowAdd(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-orange text-white hover:bg-brand-orange/90 transition-colors">
            + Add Directory
          </button>
        </div>
      </div>

      {error && !loading && (
        <div className="flex items-center justify-between text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-3 text-red-400 hover:text-red-700 font-medium">✕</button>
        </div>
      )}

      {researchMsg && (
        <p className="text-xs text-brand-orange bg-brand-orange/5 border border-brand-orange/20 rounded-lg px-3 py-2">
          {researchMsg}
        </p>
      )}

      {/* Table */}
      <div className="card p-0 overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-xs text-brand-muted">Loading…</div>
        ) : !loading && dirs.length === 0 && error ? (
          <div className="p-8 text-center text-xs text-red-600">{error}</div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-brand-border bg-brand-offwhite/50">
                {["Directory", "Priority", "Cost", "Complexity", "Status", "Date", "Notes", ""].map(h => (
                  <th key={h} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-xs text-brand-muted">No directories match the current filters.</td></tr>
              ) : (
                filtered.map(dir => (
                  <DirectoryRow key={dir.id} dir={dir} onUpdate={handleUpdate} onDelete={handleDelete} />
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <AddDirectoryModal
          onClose={() => setShowAdd(false)}
          onCreated={newDir => setDirs(prev => [newDir as unknown as Directory, ...prev])}
        />
      )}
    </div>
  );
}
