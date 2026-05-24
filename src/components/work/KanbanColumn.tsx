"use client";

import clsx from "clsx";
import type { WorkItem, WorkStatus } from "@/types";
import { KanbanCard } from "./KanbanCard";

type Props = {
  status: WorkStatus;
  label: string;
  items: WorkItem[];
  pillClass: string;
  onMove: (id: string, next: WorkStatus) => void;
  allowedTargets: (current: WorkStatus) => WorkStatus[];
  statusLabel: (s: WorkStatus) => string;
};

export function KanbanColumn({
  status,
  label,
  items,
  pillClass,
  onMove,
  allowedTargets,
  statusLabel,
}: Props) {
  return (
    <div className="flex flex-col w-72 flex-shrink-0 bg-brand-offwhite rounded p-2">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <span
            className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold", pillClass)}
          >
            {label}
          </span>
        </div>
        <span className="text-xs text-brand-muted">{items.length}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto min-h-[60px]">
        {items.length === 0 ? (
          <div className="text-xs text-brand-muted text-center py-6">No items</div>
        ) : (
          items.map((item) => (
            <KanbanCard
              key={item.id}
              item={item}
              onMove={onMove}
              allowedTargets={allowedTargets(status)}
              statusLabel={statusLabel}
            />
          ))
        )}
      </div>
    </div>
  );
}
