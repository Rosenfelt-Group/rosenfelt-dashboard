import clsx from "clsx";
import type { WorkItemSource } from "@/types";

type Props = {
  source: WorkItemSource | null | undefined;
  sprintNumber?: number | null;
  /** Phase sub-step (text, e.g. "1.6"). Preferred over sprintNumber in the chip. */
  phaseStep?: string | null;
  className?: string;
};

// Phase 0.7: both build-plan-origin sources ('sprint_plan' and the 0-row legacy
// 'sprint') display as "From Plan Doc". source is provenance only — phase
// membership is shown separately via the Phase chip below.
const SOURCE_META: Record<
  Exclude<WorkItemSource, "manual">,
  { label: string; icon: string; pill: string }
> = {
  casey_audit:      { label: "Audit",        icon: "🛡️", pill: "bg-rose-100 text-rose-700" },
  sprint_plan:      { label: "From Plan Doc", icon: "📋", pill: "bg-blue-100 text-blue-700" },
  sprint:           { label: "From Plan Doc", icon: "📋", pill: "bg-blue-100 text-blue-700" },
  agent_suggestion: { label: "Suggested",    icon: "💡", pill: "bg-purple-100 text-purple-700" },
  backlog_migration:{ label: "Migrated",     icon: "",   pill: "bg-gray-100 text-gray-600" },
  typeform:         { label: "Typeform",     icon: "📝", pill: "bg-teal-100 text-teal-700" },
  stripe:           { label: "Stripe",       icon: "💳", pill: "bg-indigo-100 text-indigo-700" },
};

// Renders up to two chips: a provenance chip (omitted for 'manual') and a Phase
// chip (whenever sprint_number is set, regardless of source — Phase 0.7 decoupled
// phase membership from source). Returns null only when there's nothing to show.
export function SourceBadge({ source, sprintNumber, phaseStep, className }: Props) {
  const showSource = !!source && source !== "manual";
  const stepLabel = typeof phaseStep === "string" && phaseStep.trim() ? phaseStep.trim() : null;
  const showPhase = typeof sprintNumber === "number" || stepLabel !== null;
  // Prefer the text sub-step ("1.6") over the bare integer phase ("1") when set.
  const phaseLabel = stepLabel ?? (typeof sprintNumber === "number" ? String(sprintNumber) : null);
  if (!showSource && !showPhase) return null;

  // Defensive fallback: if the DB has a source the UI doesn't know about
  // (e.g. a future CHECK constraint extension that ships before this code),
  // render a neutral badge instead of crashing the whole /work page.
  const meta = showSource
    ? SOURCE_META[source as Exclude<WorkItemSource, "manual">] ?? {
        label: source as string,
        icon: "",
        pill: "bg-gray-100 text-gray-600",
      }
    : null;

  return (
    <>
      {meta && (
        <span
          className={clsx(
            "inline-flex items-center gap-1 rounded-full text-xs px-2 py-0.5 font-medium",
            meta.pill,
            className,
          )}
          title={`Source: ${meta.label}`}
        >
          {meta.icon && <span>{meta.icon}</span>}
          <span>{meta.label}</span>
        </span>
      )}
      {showPhase && phaseLabel !== null && (
        <span
          className={clsx(
            "inline-flex items-center gap-1 rounded-full text-xs px-2 py-0.5 font-medium",
            "bg-emerald-100 text-emerald-700",
            className,
          )}
          title={`Phase ${phaseLabel}`}
        >
          <span>Phase {phaseLabel}</span>
        </span>
      )}
    </>
  );
}
