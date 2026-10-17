"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Button, EmptyState } from "@/components/ui";
import type { WorkItem } from "@/types";
import { STATUS_LABEL } from "@/components/work/work-constants";
import { NewClientWorkItemModal } from "./NewClientWorkItemModal";

export function WorkItemsTab({
  clientId,
  workItems,
  onReload,
}: {
  clientId: string;
  workItems: WorkItem[];
  onReload: () => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "in_progress" | "done">("all");

  const filtered = useMemo(() => {
    if (statusFilter === "all") return workItems;
    if (statusFilter === "open") return workItems.filter((w) => ["inbox", "approved", "open", "prompt_ready"].includes(w.status));
    return workItems.filter((w) => w.status === statusFilter);
  }, [workItems, statusFilter]);

  return (
    <>
      <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
        <div className="inline-flex items-center gap-1 rounded border border-brand-border bg-white p-0.5">
          {(["all", "open", "in_progress", "done"] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setStatusFilter(opt)}
              className={clsx(
                "text-xs px-2.5 py-1 rounded capitalize",
                statusFilter === opt ? "bg-brand-orange text-white" : "text-brand-muted hover:bg-brand-cream",
              )}
            >
              {opt.replace("_", " ")}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setShowNew(true)}>
          + New client work item
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={workItems.length === 0 ? "No client work items yet." : `No items in '${statusFilter}'.`}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((w) => (
            <Link key={w.id} href={`/work/${w.id}`} className="block card hover:border-brand-orange/40">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-brand-black">{w.title}</div>
                  <div className="text-[11px] text-brand-muted mt-0.5">
                    {w.work_type} · {w.priority} · {STATUS_LABEL[w.status] ?? w.status}
                    {w.due_date && ` · due ${w.due_date}`}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showNew && (
        <NewClientWorkItemModal
          clientId={clientId}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); onReload(); }}
        />
      )}
    </>
  );
}
