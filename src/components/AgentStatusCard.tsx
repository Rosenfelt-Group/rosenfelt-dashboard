import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { AgentBadge } from "./AgentBadge";
import { Agent, AgentStatus } from "@/types";

const AGENT_META: Partial<Record<Agent, { name: string; role: string }>> = {
  jordan: { name: "Jordan", role: "Dev & Infra" },
  riley:  { name: "Riley",  role: "Operations" },
  avery:  { name: "Avery",  role: "Content & SEO" },
  casey:  { name: "Casey",  role: "Audit & Integrity" },
  sam:    { name: "Sam",    role: "Accounting & Legal" },
};

export type LiveStatus = "working" | "live" | "idle";

// There's no live worker-busy signal in the schema — `workflow_logs` is a
// historical record, not a heartbeat. This derives a reasonable approximation
// from log recency rather than a literal "is this agent executing right now".
export function deriveAgentStatus(a: AgentStatus): LiveStatus {
  if (!a.last_execution) return "idle";
  const ageMs = Date.now() - new Date(a.last_execution).getTime();
  if (ageMs < 2 * 60_000) return "working";
  return a.executions_24h > 0 ? "live" : "idle";
}

const STATUS_LABEL: Record<LiveStatus, string> = { working: "Working", live: "Live", idle: "Idle" };
const STATUS_DOT: Record<LiveStatus, string> = {
  working: "bg-brand-status-working",
  live:    "bg-brand-status-ok",
  idle:    "bg-brand-status-idle",
};

export function AgentStatusCard({ status }: { status: AgentStatus }) {
  const meta = AGENT_META[status.agent] ?? { name: status.agent, role: "" };
  const live = deriveAgentStatus(status);

  return (
    <div className="card flex items-center gap-3 p-4">
      <AgentBadge agent={status.agent} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-brand-black truncate">{meta.name}</p>
          <span className={clsx("w-1.5 h-1.5 rounded-full flex-shrink-0", STATUS_DOT[live])} aria-hidden="true" />
          <span className="text-[11px] text-brand-muted">{STATUS_LABEL[live]}</span>
        </div>
        <p className="text-xs text-brand-muted truncate">{meta.role}</p>
        <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-brand-muted flex-wrap">
          <span>
            {status.last_execution
              ? `Active ${formatDistanceToNow(new Date(status.last_execution), { addSuffix: true })}`
              : "No activity yet"}
          </span>
          <span aria-hidden="true">·</span>
          {/* Workload proxy — count of runs in the last 24h, not a true load metric */}
          <span>{status.executions_24h} run{status.executions_24h !== 1 ? "s" : ""}/24h</span>
          {status.errors_24h > 0 && (
            <span className="text-red-600 font-medium">{status.errors_24h} err</span>
          )}
        </div>
      </div>
    </div>
  );
}
