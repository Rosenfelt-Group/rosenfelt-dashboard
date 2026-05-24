"use client";

import { useState } from "react";

type Props = {
  selectedIds: string[];
  onClear: () => void;
  onComplete: () => void | Promise<void>;
};

const STATUSES = [
  "inbox", "approved", "prompt_ready", "in_progress", "open",
  "done", "deferred", "cancelled", "rejected",
];
const PRIORITIES = ["low", "medium", "high"];
const AGENTS = ["brian", "jordan", "riley", "avery", "casey"];

export function BulkActionBar({ selectedIds, onClear, onComplete }: Props) {
  const [pending, setPending] = useState(false);

  async function bulkUpdate(updates: Record<string, unknown>) {
    setPending(true);
    try {
      const res = await fetch("/api/work/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, updates }),
      });
      if (res.ok) {
        await onComplete();
      } else {
        console.error("bulk update failed:", await res.text());
      }
    } finally {
      setPending(false);
    }
  }

  async function archive() {
    if (!confirm(`Archive ${selectedIds.length} item(s)?`)) return;
    await bulkUpdate({ archived: true });
  }

  async function cancelAll() {
    if (!confirm(`Cancel ${selectedIds.length} item(s)?`)) return;
    await bulkUpdate({ status: "cancelled" });
  }

  if (selectedIds.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-brand-black text-white p-3 shadow-lg z-40">
      <div className="max-w-7xl mx-auto flex items-center gap-3 flex-wrap text-xs">
        <span className="font-semibold">{selectedIds.length} selected</span>
        <select
          disabled={pending}
          onChange={(e) => e.target.value && bulkUpdate({ status: e.target.value })}
          defaultValue=""
          className="rounded text-brand-black px-2 py-1"
        >
          <option value="">Status…</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          disabled={pending}
          onChange={(e) => e.target.value && bulkUpdate({ priority: e.target.value })}
          defaultValue=""
          className="rounded text-brand-black px-2 py-1"
        >
          <option value="">Priority…</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          disabled={pending}
          onChange={(e) => e.target.value && bulkUpdate({ assigned_agent: e.target.value })}
          defaultValue=""
          className="rounded text-brand-black px-2 py-1"
        >
          <option value="">Assign…</option>
          {AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <button
          onClick={archive}
          disabled={pending}
          className="px-3 py-1 bg-white/10 rounded hover:bg-white/20"
        >
          Archive
        </button>
        <button
          onClick={cancelAll}
          disabled={pending}
          className="px-3 py-1 bg-white/10 rounded hover:bg-white/20"
        >
          Cancel
        </button>
        <button onClick={onClear} className="ml-auto px-3 py-1 hover:underline">
          ✕ Clear
        </button>
      </div>
    </div>
  );
}
