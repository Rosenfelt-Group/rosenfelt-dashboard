"use client";
import { useEffect, useRef, useState } from "react";
import { KeywordTracker } from "@/types";
import clsx from "clsx";

// ─── Display helpers ──────────────────────────────────────────────────────────

const DIFFICULTY_STYLES: Record<KeywordTracker["difficulty"], string> = {
  low:    "bg-green-50 text-green-700",
  medium: "bg-amber-50 text-amber-700",
  high:   "bg-red-50 text-red-700",
};

const STATUS_STYLES: Record<KeywordTracker["status"], string> = {
  planned:     "bg-gray-100 text-gray-600",
  in_progress: "bg-blue-50 text-blue-700",
  published:   "bg-green-50 text-green-700",
  monitoring:  "bg-orange-50 text-brand-orange",
};

const STATUS_LABELS: Record<KeywordTracker["status"], string> = {
  planned:     "Planned",
  in_progress: "In Progress",
  published:   "Published",
  monitoring:  "Monitoring",
};

const TIER_STYLES: Record<KeywordTracker["tier"], string> = {
  "1": "bg-orange-50 text-brand-orange",
  "2": "bg-blue-50 text-blue-700",
  "3": "bg-gray-100 text-gray-500",
};

const TIER_LABELS: Record<KeywordTracker["tier"], string> = {
  "1": "Tier 1",
  "2": "Tier 2",
  "3": "Tier 3",
};

function fmtVol(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1000) return `${Math.round(n / 100) / 10}K`;
  return String(n);
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function PositionCell({ current, target }: { current: number | null; target: number }) {
  const color = current == null
    ? "text-brand-muted"
    : current <= target
    ? "text-green-700"
    : current <= target + 10
    ? "text-amber-700"
    : "text-red-600";
  return (
    <span className="text-xs">
      <span className={clsx("font-medium", color)}>
        {current == null ? "—" : `#${current}`}
      </span>
      <span className="text-brand-muted"> / top {target}</span>
    </span>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  keyword: "",
  tier: "1" as KeywordTracker["tier"],
  difficulty: "medium" as KeywordTracker["difficulty"],
  monthly_volume_est: "" as string | number,
  target_position: 10,
  current_position: "" as string | number,
  vertical: "",
  status: "planned" as KeywordTracker["status"],
  assigned_post_url: "",
  last_checked: "",
  notes: "",
};

type FormState = typeof EMPTY_FORM;

function KeywordModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: KeywordTracker;
  onSave: (data: Partial<KeywordTracker>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(
    initial
      ? {
          keyword:            initial.keyword ?? "",
          tier:               initial.tier,
          difficulty:         initial.difficulty,
          monthly_volume_est: initial.monthly_volume_est ?? "",
          target_position:    initial.target_position,
          current_position:   initial.current_position ?? "",
          vertical:           initial.vertical ?? "",
          status:             initial.status,
          assigned_post_url:  initial.assigned_post_url ?? "",
          last_checked:       initial.last_checked ?? "",
          notes:              initial.notes ?? "",
        }
      : EMPTY_FORM,
  );
  const [saving, setSaving] = useState(false);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function handleSubmit() {
    if (!form.keyword.trim()) return;
    setSaving(true);
    const payload: Partial<KeywordTracker> = {
      keyword:            form.keyword.trim(),
      tier:               form.tier,
      difficulty:         form.difficulty,
      monthly_volume_est: form.monthly_volume_est === "" ? null : Number(form.monthly_volume_est),
      target_position:    Number(form.target_position) || 10,
      current_position:   form.current_position === "" ? null : Number(form.current_position),
      vertical:           form.vertical.trim() || null,
      status:             form.status,
      assigned_post_url:  form.assigned_post_url.trim() || null,
      last_checked:       form.last_checked || null,
      notes:              form.notes.trim() || null,
    };
    await onSave(payload);
    setSaving(false);
    onClose();
  }

  const inputCls = "w-full border border-brand-border rounded-lg px-3 py-2 text-sm text-brand-black focus:outline-none focus:ring-2 focus:ring-brand-orange/30 bg-white";
  const labelCls = "block text-xs font-medium text-brand-muted mb-1";

  return (
    <div
      className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-lg w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-semibold text-brand-black">
          {initial ? "Edit keyword" : "Add keyword"}
        </h2>

        <div>
          <label className={labelCls}>Keyword *</label>
          <input className={inputCls} value={form.keyword} onChange={e => set("keyword", e.target.value)} placeholder="e.g. AI for small accounting firms" />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Tier</label>
            <select className={inputCls} value={form.tier} onChange={e => set("tier", e.target.value as KeywordTracker["tier"])}>
              <option value="1">Tier 1 — now</option>
              <option value="2">Tier 2 — months 3–6</option>
              <option value="3">Tier 3 — year 2+</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Difficulty</label>
            <select className={inputCls} value={form.difficulty} onChange={e => set("difficulty", e.target.value as KeywordTracker["difficulty"])}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select className={inputCls} value={form.status} onChange={e => set("status", e.target.value as KeywordTracker["status"])}>
              <option value="planned">Planned</option>
              <option value="in_progress">In Progress</option>
              <option value="published">Published</option>
              <option value="monitoring">Monitoring</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Monthly vol. (est.)</label>
            <input type="number" className={inputCls} value={form.monthly_volume_est} onChange={e => set("monthly_volume_est", e.target.value)} placeholder="e.g. 1200" />
          </div>
          <div>
            <label className={labelCls}>Current position</label>
            <input type="number" className={inputCls} value={form.current_position} onChange={e => set("current_position", e.target.value)} placeholder="e.g. 24" />
          </div>
          <div>
            <label className={labelCls}>Target position</label>
            <input type="number" className={inputCls} value={form.target_position} onChange={e => set("target_position", Number(e.target.value))} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Vertical</label>
            <input className={inputCls} value={form.vertical} onChange={e => set("vertical", e.target.value)} placeholder="e.g. accounting, nonprofit" />
          </div>
          <div>
            <label className={labelCls}>Last checked</label>
            <input type="date" className={inputCls} value={form.last_checked} onChange={e => set("last_checked", e.target.value)} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Assigned post URL</label>
          <input className={inputCls} value={form.assigned_post_url} onChange={e => set("assigned_post_url", e.target.value)} placeholder="https://rosably.com/blog/..." />
        </div>

        <div>
          <label className={labelCls}>Notes</label>
          <textarea className={`${inputCls} resize-none`} rows={2} value={form.notes} onChange={e => set("notes", e.target.value)} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-brand-muted hover:bg-brand-offwhite transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !form.keyword.trim()}
            className="px-4 py-2 text-sm rounded-lg bg-brand-orange text-white font-medium hover:bg-orange-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : initial ? "Save changes" : "Add keyword"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type StatusFilter  = "all" | KeywordTracker["status"];
type TierFilter    = "all" | KeywordTracker["tier"];
type DiffFilter    = "all" | KeywordTracker["difficulty"];

export default function KeywordsPage() {
  const [rows, setRows]       = useState<KeywordTracker[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [statusF, setStatusF] = useState<StatusFilter>("all");
  const [tierF, setTierF]     = useState<TierFilter>("all");
  const [diffF, setDiffF]     = useState<DiffFilter>("all");
  const [modal, setModal]     = useState<{ mode: "add" } | { mode: "edit"; row: KeywordTracker } | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const loadedRef             = useRef(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/keyword-tracker");
    if (res.ok) setRows(await res.json());
    setLoading(false);
    loadedRef.current = true;
  }

  useEffect(() => { load(); }, []);

  async function handleSave(data: Partial<KeywordTracker>) {
    if (modal?.mode === "edit") {
      const res = await fetch("/api/keyword-tracker", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: modal.row.id, ...data }),
      });
      if (!res.ok) { setError("Failed to save."); return; }
      const updated: KeywordTracker = await res.json();
      setRows(prev => prev.map(r => r.id === updated.id ? updated : r));
    } else {
      const res = await fetch("/api/keyword-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) { setError("Failed to add."); return; }
      const created: KeywordTracker = await res.json();
      setRows(prev => [...prev, created].sort((a, b) => {
        if (a.tier !== b.tier) return a.tier.localeCompare(b.tier);
        return (a.keyword ?? "").localeCompare(b.keyword ?? "");
      }));
    }
  }

  const filtered = rows.filter(r => {
    if (statusF !== "all" && r.status !== statusF) return false;
    if (tierF   !== "all" && r.tier   !== tierF)   return false;
    if (diffF   !== "all" && r.difficulty !== diffF) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !(r.keyword ?? "").toLowerCase().includes(q) &&
        !(r.vertical ?? "").toLowerCase().includes(q) &&
        !(r.notes ?? "").toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const counts = {
    total:       rows.length,
    published:   rows.filter(r => r.status === "published").length,
    in_progress: rows.filter(r => r.status === "in_progress").length,
    monitoring:  rows.filter(r => r.status === "monitoring").length,
    planned:     rows.filter(r => r.status === "planned").length,
  };

  function FilterPill<T extends string>({
    value, active, onClick, children,
  }: { value: T; active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
      <button
        onClick={onClick}
        className={clsx(
          "px-3 py-1 rounded-full text-xs font-medium transition-colors",
          active
            ? "bg-brand-orange text-white"
            : "bg-brand-offwhite text-brand-muted hover:text-brand-black",
        )}
      >
        {children}
      </button>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">SEO Keywords</h1>
          <p className="text-sm text-brand-muted mt-0.5">Keyword tracking — Supabase keyword_tracker table</p>
        </div>
        <button
          onClick={() => setModal({ mode: "add" })}
          className="flex items-center gap-1.5 px-3 py-2 bg-brand-orange text-white text-sm font-medium rounded-lg hover:bg-orange-700 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add keyword
        </button>
      </div>

      {/* Stats strip */}
      {!loading && rows.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <span className="text-brand-black font-medium">{counts.total} keywords</span>
          <span className="text-green-700">{counts.published} published</span>
          <span className="text-blue-700">{counts.in_progress} in progress</span>
          <span className="text-brand-orange">{counts.monitoring} monitoring</span>
          <span className="text-brand-muted">{counts.planned} planned</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Status */}
        <div className="flex gap-1">
          {(["all", "planned", "in_progress", "published", "monitoring"] as const).map(s => (
            <FilterPill key={s} value={s} active={statusF === s} onClick={() => setStatusF(s)}>
              {s === "all" ? "All status" : STATUS_LABELS[s as KeywordTracker["status"]]}
            </FilterPill>
          ))}
        </div>

        <div className="h-4 w-px bg-brand-border hidden sm:block" />

        {/* Tier */}
        <div className="flex gap-1">
          {(["all", "1", "2", "3"] as const).map(t => (
            <FilterPill key={t} value={t} active={tierF === t} onClick={() => setTierF(t)}>
              {t === "all" ? "All tiers" : TIER_LABELS[t]}
            </FilterPill>
          ))}
        </div>

        <div className="h-4 w-px bg-brand-border hidden sm:block" />

        {/* Search */}
        <input
          type="text"
          placeholder="Search keywords…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-brand-border rounded-lg px-3 py-1 text-sm text-brand-black placeholder:text-brand-muted focus:outline-none focus:ring-2 focus:ring-brand-orange/30 w-48"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-brand-muted">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-brand-muted">
              {rows.length === 0 ? "No keywords tracked yet." : "No keywords match these filters."}
            </p>
            {rows.length === 0 && (
              <button
                onClick={() => setModal({ mode: "add" })}
                className="mt-3 text-sm text-brand-orange hover:underline"
              >
                Add your first keyword →
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-border bg-brand-offwhite">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-brand-muted uppercase tracking-wide">Keyword</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-brand-muted uppercase tracking-wide">Tier</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-brand-muted uppercase tracking-wide">Difficulty</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-brand-muted uppercase tracking-wide">Volume</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-brand-muted uppercase tracking-wide">Position</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-brand-muted uppercase tracking-wide">Status</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-brand-muted uppercase tracking-wide hidden lg:table-cell">Vertical</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-brand-muted uppercase tracking-wide hidden lg:table-cell">Post</th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-brand-muted uppercase tracking-wide hidden xl:table-cell">Checked</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {filtered.map(row => (
                  <tr key={row.id} className="hover:bg-brand-offwhite/50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-medium text-brand-black">{row.keyword ?? "—"}</span>
                      {row.notes && (
                        <p className="text-xs text-brand-muted mt-0.5 max-w-xs truncate">{row.notes}</p>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className={clsx("badge text-xs", TIER_STYLES[row.tier])}>
                        {TIER_LABELS[row.tier]}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={clsx("badge text-xs capitalize", DIFFICULTY_STYLES[row.difficulty])}>
                        {row.difficulty}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-brand-muted text-xs tabular-nums">
                      {fmtVol(row.monthly_volume_est)}
                    </td>
                    <td className="px-3 py-3">
                      <PositionCell current={row.current_position} target={row.target_position} />
                    </td>
                    <td className="px-3 py-3">
                      <span className={clsx("badge text-xs", STATUS_STYLES[row.status])}>
                        {STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-brand-muted hidden lg:table-cell">
                      {row.vertical ?? "—"}
                    </td>
                    <td className="px-3 py-3 hidden lg:table-cell">
                      {row.assigned_post_url ? (
                        <a
                          href={row.assigned_post_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-orange hover:underline text-xs flex items-center gap-1"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                          </svg>
                          View post
                        </a>
                      ) : (
                        <span className="text-xs text-brand-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-brand-muted hidden xl:table-cell">
                      {fmtDate(row.last_checked)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        onClick={() => setModal({ mode: "edit", row })}
                        className="text-xs text-brand-muted hover:text-brand-black transition-colors px-2 py-1 rounded hover:bg-brand-offwhite"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <KeywordModal
          initial={modal.mode === "edit" ? modal.row : undefined}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
