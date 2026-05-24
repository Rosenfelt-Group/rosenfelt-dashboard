import clsx from "clsx";
import type { WorkItemSource } from "@/types";

type Props = {
  source: WorkItemSource | null | undefined;
  className?: string;
};

const SOURCE_META: Record<
  Exclude<WorkItemSource, "manual">,
  { label: string; icon: string; pill: string }
> = {
  casey_audit:      { label: "Audit",     icon: "🛡️", pill: "bg-rose-100 text-rose-700" },
  sprint_plan:      { label: "Sprint",    icon: "📅", pill: "bg-blue-100 text-blue-700" },
  agent_suggestion: { label: "Suggested", icon: "💡", pill: "bg-purple-100 text-purple-700" },
  backlog_migration:{ label: "Migrated",  icon: "",   pill: "bg-gray-100 text-gray-600" },
};

// 'manual' renders nothing — most items are manual and a badge would be noise.
export function SourceBadge({ source, className }: Props) {
  if (!source || source === "manual") return null;
  const meta = SOURCE_META[source];
  return (
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
  );
}
