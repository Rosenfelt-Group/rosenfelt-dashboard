"use client";
import { useState } from "react";
import { differenceInDays } from "date-fns";
import clsx from "clsx";
import Link from "next/link";
import { CRMLead, CRMStage } from "@/types";
import { STAGES } from "@/lib/crm/stages";

const SOURCE_LABELS: Record<string, string> = {
  website_contact: "Contact form",
  website_assessment: "Assessment",
  manual: "Manual",
  referral: "Referral",
};

type Props = {
  leads: CRMLead[];
  onMoveStage: (leadId: string, stage: CRMStage) => void;
};

/** Kanban board of leads by stage; drag a card onto another column to move it. */
export function LeadsBoard({ leads, onMoveStage }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const byStage = (s: CRMStage) => leads.filter(l => l.stage === s);

  return (
    <div className="flex flex-wrap gap-3">
      {STAGES.filter(col => !col.isQuizStage || byStage(col.stage).length > 0).map(col => (
        <div
          key={col.stage}
          onDragOver={e => e.preventDefault()}
          onDrop={() => {
            if (dragId && leads.find(l => l.id === dragId)?.stage !== col.stage) {
              onMoveStage(dragId, col.stage);
            }
            setDragId(null);
          }}
          className="min-h-[200px] flex-1 basis-[140px]"
        >
          <div className="flex items-center justify-between mb-3">
            <span className={clsx("badge text-xs", col.color)}>{col.label}</span>
            <span className="text-xs text-brand-muted">{byStage(col.stage).length}</span>
          </div>
          <div className="space-y-2">
            {byStage(col.stage).map(lead => (
              <div
                key={lead.id}
                draggable
                onDragStart={() => setDragId(lead.id)}
                onDragEnd={() => setDragId(null)}
                className="cursor-grab active:cursor-grabbing"
              >
                <Link
                  href={`/crm/leads/${lead.id}`}
                  className="block card p-3 hover:border-brand-orange transition-colors"
                >
                  <p className="text-xs font-medium text-brand-black truncate">
                    {lead.business?.name ?? "—"}
                  </p>
                  <p className="text-xs text-brand-muted truncate mt-0.5">
                    {lead.contact
                      ? `${lead.contact.first_name}${lead.contact.last_name ? " " + lead.contact.last_name : ""}`
                      : "—"}
                  </p>
                  {lead.source && (
                    <span className="badge badge-neutral text-xs mt-1.5 block w-fit">
                      {SOURCE_LABELS[lead.source] ?? lead.source}
                    </span>
                  )}
                  <p className="text-xs text-brand-muted mt-1.5">
                    {differenceInDays(new Date(), new Date(lead.updated_at))}d in stage
                  </p>
                </Link>
              </div>
            ))}
            {byStage(col.stage).length === 0 && (
              <div className="border-2 border-dashed border-brand-border rounded-lg p-3 min-h-[60px] flex items-center justify-center">
                <p className="text-xs text-brand-muted">—</p>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
