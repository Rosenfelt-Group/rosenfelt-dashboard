"use client";
import { useState } from "react";
import clsx from "clsx";

const PRIORITY_OPTIONS = ["Submit Now", "Submit Soon", "Low Priority"];
const COMPLEXITY_OPTIONS = ["Easy", "Moderate", "Complex"];
const STATUS_OPTIONS = ["Not Started", "In Progress", "Submitted", "Live", "Skipped"];

interface Props {
  onClose: () => void;
  onCreated: (dir: Record<string, unknown>) => void;
}

export default function AddDirectoryModal({ onClose, onCreated }: Props) {
  const [form, setForm] = useState({
    name: "", url: "", priority_tier: "Submit Soon",
    cost: "", complexity: "Easy", status: "Not Started",
    date_completed: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/marketing/directories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          date_completed: form.date_completed || null,
          cost: form.cost || null,
          notes: form.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to create"); return; }
      onCreated(data);
      onClose();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-brand-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-brand-black">Add Directory</h2>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-black transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-brand-muted mb-1">Directory Name *</label>
              <input required value={form.name} onChange={e => set("name", e.target.value)}
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-brand-muted mb-1">URL *</label>
              <input required value={form.url} onChange={e => set("url", e.target.value)}
                placeholder="example.com"
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange" />
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Priority</label>
              <select value={form.priority_tier} onChange={e => set("priority_tier", e.target.value)}
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange">
                {PRIORITY_OPTIONS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Status</label>
              <select value={form.status} onChange={e => set("status", e.target.value)}
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange">
                {STATUS_OPTIONS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Cost</label>
              <input value={form.cost} onChange={e => set("cost", e.target.value)}
                placeholder="Free"
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange" />
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Complexity</label>
              <select value={form.complexity} onChange={e => set("complexity", e.target.value)}
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange">
                {COMPLEXITY_OPTIONS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Date Completed</label>
              <input type="date" value={form.date_completed} onChange={e => set("date_completed", e.target.value)}
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-brand-muted mb-1">Notes</label>
              <textarea value={form.notes} onChange={e => set("notes", e.target.value)}
                rows={2}
                className="w-full text-sm border border-brand-border rounded-lg px-3 py-2 focus:outline-none focus:border-brand-orange resize-none" />
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-brand-border text-brand-muted hover:bg-brand-offwhite transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className={clsx("px-4 py-2 text-sm rounded-lg font-medium transition-colors",
                saving ? "bg-brand-offwhite text-brand-muted cursor-not-allowed"
                        : "bg-brand-orange text-white hover:bg-brand-orange/90")}>
              {saving ? "Saving…" : "Add Directory"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
