"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import { AgentBadge } from "@/components/AgentBadge";
import { SourceBadge } from "./SourceBadge";
import type {
  AgentName,
  TaskPriority,
  WorkItem,
  WorkStatus,
  WorkType,
} from "@/types";

const PRIORITY_DOT: Record<TaskPriority, string> = {
  high:   "bg-red-500",
  medium: "bg-amber-400",
  low:    "bg-gray-300",
};

const WORK_TYPE_STYLES: Record<WorkType, string> = {
  infrastructure: "bg-gray-100 text-gray-700",
  agent:          "bg-amber-100 text-amber-700",
  dashboard:      "bg-blue-100 text-blue-700",
  content:        "bg-teal-100 text-teal-700",
  website:        "bg-purple-100 text-purple-700",
  operations:     "bg-slate-100 text-slate-700",
  business:       "bg-orange-100 text-orange-700",
  workflow:       "bg-indigo-100 text-indigo-700",
  deliverable:    "bg-emerald-100 text-emerald-700",
  intake:         "bg-cyan-100 text-cyan-700",
};

function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const sec = Math.max(1, Math.floor((now - then) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  return `${mo}mo ago`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

type Props = {
  item: WorkItem;
  onMove: (id: string, next: WorkStatus) => void;
  allowedTargets: WorkStatus[];
  statusLabel: (s: WorkStatus) => string;
};

export function KanbanCard({ item, onMove, allowedTargets, statusLabel }: Props) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      onClick={() => router.push(`/work/${item.ref}`)}
      className="bg-white rounded border border-brand-border p-3 hover:shadow-sm hover:border-brand-orange/40 cursor-pointer transition relative"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <SourceBadge
            source={item.source}
            sprintNumber={item.sprint_number}
            phaseStep={item.phase_step}
          />
          <span
            className={clsx("w-2 h-2 rounded-full inline-block", PRIORITY_DOT[item.priority])}
            title={`Priority: ${item.priority}`}
          />
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="text-brand-muted hover:text-brand-black -mr-1 -mt-1 px-1 text-base leading-none"
          title="More actions"
        >
          ⋯
        </button>
        {menuOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute right-2 top-7 bg-white border border-brand-border rounded shadow-md z-20 min-w-[150px] py-1"
          >
            <div className="text-[10px] uppercase tracking-wide text-brand-muted px-3 pt-1">
              Move to
            </div>
            {allowedTargets.length === 0 ? (
              <div className="px-3 py-1 text-xs text-brand-muted">No transitions</div>
            ) : (
              allowedTargets.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setMenuOpen(false);
                    onMove(item.id, s);
                  }}
                  className="block w-full text-left px-3 py-1.5 text-xs hover:bg-brand-offwhite"
                >
                  {statusLabel(s)}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="text-sm font-medium text-brand-black mb-2 line-clamp-2">
        <span className="text-brand-muted font-normal mr-1">#{item.ref}</span>
        {item.title}
      </div>

      <div className="flex items-center gap-2 text-xs text-brand-muted mb-2">
        <span
          className={clsx(
            "px-1.5 py-0.5 rounded text-[10px] font-medium",
            WORK_TYPE_STYLES[item.work_type],
          )}
        >
          {item.work_type}
        </span>
        {item.assigned_agent && (
          <AgentBadge agent={item.assigned_agent as AgentName} size="sm" />
        )}
      </div>

      <LastLogPreview item={item} />
    </div>
  );
}

function LastLogPreview({ item }: { item: WorkItem }) {
  const log = item.last_log;
  if (!log) {
    return (
      <div className="border-t border-brand-border pt-2 mt-1">
        <div className="text-[10px] text-brand-muted italic">No activity</div>
      </div>
    );
  }
  return (
    <div className="border-t border-brand-border pt-2 mt-1">
      <div className="flex items-center gap-1.5 text-[10px] text-brand-muted mb-0.5">
        {/* Author can be an agent name or 'brian'; only render badge for known agents. */}
        {(["jordan", "riley", "avery", "casey", "brian"] as const).includes(
          log.author as AgentName,
        ) && <AgentBadge agent={log.author as AgentName} size="sm" />}
        <span className="px-1 rounded bg-brand-cream text-brand-black">
          {log.entry_type}
        </span>
        <span>{timeAgo(log.created_at)}</span>
      </div>
      <div className="text-[11px] text-brand-black/80 line-clamp-2">
        {truncate(log.message, 80)}
      </div>
    </div>
  );
}
