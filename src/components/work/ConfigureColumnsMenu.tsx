"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkStatus } from "@/types";

type Props = {
  allStatuses: WorkStatus[];
  visible: WorkStatus[];
  order: WorkStatus[];
  statusLabel: (s: WorkStatus) => string;
  onChange: (next: { visible: WorkStatus[]; order: WorkStatus[] }) => void;
};

export function ConfigureColumnsMenu({
  allStatuses,
  visible,
  order,
  statusLabel,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Display order: respect persisted order, then append any new statuses at the end.
  const displayOrder: WorkStatus[] = [
    ...order.filter((s) => allStatuses.includes(s)),
    ...allStatuses.filter((s) => !order.includes(s)),
  ];

  function toggleVisible(status: WorkStatus) {
    const next = visible.includes(status)
      ? visible.filter((s) => s !== status)
      : [...visible, status];
    onChange({ visible: next, order: displayOrder });
  }

  function move(status: WorkStatus, direction: -1 | 1) {
    const idx = displayOrder.indexOf(status);
    if (idx < 0) return;
    const target = idx + direction;
    if (target < 0 || target >= displayOrder.length) return;
    const next = [...displayOrder];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange({ visible, order: next });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded border border-brand-border bg-white text-xs px-2 py-1 hover:bg-brand-cream"
        title="Configure columns"
      >
        ⚙ Columns
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-white border border-brand-border rounded shadow-md z-20 p-2">
          <div className="text-[10px] uppercase tracking-wide text-brand-muted px-1 mb-1">
            Visible columns
          </div>
          <ul className="space-y-0.5">
            {displayOrder.map((status, idx) => {
              const isVisible = visible.includes(status);
              return (
                <li
                  key={status}
                  className="flex items-center gap-2 px-2 py-1 hover:bg-brand-offwhite rounded"
                >
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={() => toggleVisible(status)}
                    className="cursor-pointer"
                  />
                  <span className="flex-1 text-xs text-brand-black">
                    {statusLabel(status)}
                  </span>
                  <button
                    onClick={() => move(status, -1)}
                    disabled={idx === 0}
                    className="text-brand-muted hover:text-brand-black disabled:opacity-30 px-1"
                    title="Move up"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => move(status, 1)}
                    disabled={idx === displayOrder.length - 1}
                    className="text-brand-muted hover:text-brand-black disabled:opacity-30 px-1"
                    title="Move down"
                  >
                    ▼
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
