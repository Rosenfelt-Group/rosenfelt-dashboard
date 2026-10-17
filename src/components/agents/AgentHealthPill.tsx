import clsx from "clsx";
import type { AgentHealthRow } from "./use-agent-overview";

const STYLES = {
  up:      { label: "Up",      className: "bg-green-50 text-green-700",            dot: "bg-green-500" },
  down:    { label: "Down",    className: "bg-red-50 text-red-700",                dot: "bg-red-500" },
  unknown: { label: "Unknown", className: "bg-brand-offwhite text-brand-muted",    dot: "bg-gray-400" },
  pending: { label: "Checking…", className: "bg-brand-offwhite text-brand-muted",  dot: "bg-gray-300 animate-pulse" },
} as const;

/** Up / Down / Unknown badge for an agent's /health probe. Omit `health` while it loads. */
export function AgentHealthPill({ health }: { health?: AgentHealthRow | null }) {
  const s = health ? STYLES[health.status] ?? STYLES.unknown : STYLES.pending;
  return (
    <span
      className={clsx("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0", s.className)}
      title={health?.error ?? undefined}
    >
      <span className={clsx("w-1.5 h-1.5 rounded-full", s.dot)} aria-hidden="true" />
      {s.label}
    </span>
  );
}
