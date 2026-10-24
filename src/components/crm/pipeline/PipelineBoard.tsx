"use client";
import { useState } from "react";
import clsx from "clsx";
import { CRMStage } from "@/types";
import { stageMeta } from "@/lib/crm/stages";
import {
  daysInStage, dueLabel, dueState, groupByColumn, localDate, money, pipelineColumns,
  type EngagementProgress, type PipelineLead,
} from "@/lib/crm/pipeline";
import { EngagementBar } from "./EngagementBar";

const SOURCE_LABELS: Record<string, string> = {
  website_contact: "Contact form",
  website_assessment: "Assessment",
  manual: "Manual",
  referral: "Referral",
};

type Props = {
  leads: PipelineLead[];
  progress: Record<string, EngagementProgress>;
  onMoveStage: (leadId: string, stage: CRMStage) => void;
  onOpen: (lead: PipelineLead) => void;
};

const COLUMNS = pipelineColumns();

/**
 * Kanban board of leads. The three quiz stages share one dashed "Quiz funnel" column (automated, so
 * not a drop target); drag a card onto another column to move it, click it to open the deal drawer.
 */
export function PipelineBoard({ leads, progress, onMoveStage, onOpen }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const byCol = groupByColumn(leads, COLUMNS);
  const today = localDate();

  return (
    <div className="flex flex-wrap gap-3">
      {COLUMNS.map(col => {
        const cards = byCol[col.id];
        const total = cards.reduce((a, l) => a + (l.estimated_value ?? 0), 0);
        return (
          <div
            key={col.id}
            onDragOver={col.isQuizFunnel ? undefined : e => e.preventDefault()}
            onDrop={col.isQuizFunnel ? undefined : () => {
              const target = col.stages[0];
              if (dragId && leads.find(l => l.id === dragId)?.stage !== target) onMoveStage(dragId, target);
              setDragId(null);
            }}
            className={clsx(
              "min-h-[200px] flex-1 basis-[160px]",
              col.isQuizFunnel && "border-2 border-dashed border-indigo-200 rounded-lg p-2",
            )}
          >
            <div className="flex items-center justify-between mb-3 gap-2">
              <span className={clsx("badge text-xs", col.color)}>{col.label}</span>
              <span className="text-xs text-brand-muted whitespace-nowrap">
                {cards.length}{!col.isQuizFunnel && total ? ` · ${money(total)}` : ""}
              </span>
            </div>
            {col.isQuizFunnel && (
              <p className="text-[11px] text-brand-muted mb-2">Started → completed → snapshot viewed. Jordan follows up automatically.</p>
            )}
            <div className="space-y-2">
              {cards.map(lead => {
                const due = dueState(lead.next_step_due, today);
                const late = due === "late";
                return (
                  <div
                    key={lead.id}
                    draggable
                    onDragStart={() => setDragId(lead.id)}
                    onDragEnd={() => setDragId(null)}
                    className="cursor-grab active:cursor-grabbing"
                  >
                    <button
                      type="button"
                      onClick={() => onOpen(lead)}
                      className="w-full text-left block card p-3 hover:border-brand-orange transition-colors"
                    >
                      <p className="text-xs font-medium text-brand-black truncate">{lead.business?.name ?? "—"}</p>
                      <p className="text-xs text-brand-muted truncate mt-0.5">
                        {lead.contact
                          ? `${lead.contact.first_name}${lead.contact.last_name ? " " + lead.contact.last_name : ""}`
                          : "—"}
                      </p>
                      {col.isQuizFunnel ? (
                        <span className="badge badge-neutral text-xs mt-1.5 block w-fit">{stageMeta(lead.stage)?.label}</span>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2 mt-1.5 text-xs text-brand-muted">
                            <span className="text-brand-black">{lead.estimated_value ? money(lead.estimated_value) : "No value"}</span>
                            <span>{daysInStage(lead)}d in stage</span>
                          </div>
                          {lead.source && !lead.next_step && (
                            <span className="badge badge-neutral text-xs mt-1.5 block w-fit">{SOURCE_LABELS[lead.source] ?? lead.source}</span>
                          )}
                          <div className="mt-2"><EngagementBar progress={progress[lead.id]} /></div>
                        </>
                      )}
                      {lead.next_step && (
                        <p className={clsx("text-xs mt-1.5 line-clamp-2", late ? "text-amber-600 font-medium" : "text-brand-muted")}>
                          {late ? "⚠ " : "→ "}{lead.next_step}
                          {lead.next_step_due && ` · ${dueLabel(lead.next_step_due, today)}`}
                        </p>
                      )}
                    </button>
                  </div>
                );
              })}
              {cards.length === 0 && (
                <div className="border-2 border-dashed border-brand-border rounded-lg p-3 min-h-[60px] flex items-center justify-center">
                  <p className="text-xs text-brand-muted">—</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
