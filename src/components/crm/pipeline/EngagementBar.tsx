import clsx from "clsx";
import { ENGAGEMENT_STEPS, ENGAGEMENT_STEP_LABELS, progressLevel, type EngagementProgress } from "@/lib/crm/pipeline";

/** Four-segment Discovery → Scope → Room → Delivery bar; `labels` adds the step names underneath. */
export function EngagementBar({ progress, labels = false }: { progress?: EngagementProgress; labels?: boolean }) {
  const level = progressLevel(progress);
  const title = level
    ? `Engagement: ${ENGAGEMENT_STEPS.slice(0, level).map(s => ENGAGEMENT_STEP_LABELS[s]).join(" → ")}`
    : "Engagement not started";
  return (
    <div aria-label={title} title={title}>
      <div className="flex gap-0.5">
        {ENGAGEMENT_STEPS.map((s, i) => (
          <span key={s} className={clsx("h-1 flex-1 rounded-full", i < level ? "bg-brand-orange" : "bg-brand-border")} />
        ))}
      </div>
      {labels && (
        <div className="flex gap-0.5 mt-1.5">
          {ENGAGEMENT_STEPS.map((s, i) => (
            <span key={s} className={clsx("flex-1 text-[11px]", i < level ? "text-brand-black font-medium" : "text-brand-muted")}>
              {i < level ? "✓ " : ""}{ENGAGEMENT_STEP_LABELS[s]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
