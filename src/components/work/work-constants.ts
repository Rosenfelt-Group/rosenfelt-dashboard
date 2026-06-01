import type {
  AgentName,
  TaskPriority,
  WorkItemSource,
  WorkItemType,
  WorkStatus,
  WorkType,
} from "@/types";

export const WORK_TYPES: WorkType[] = [
  "infrastructure", "agent", "dashboard", "content",
  "website", "operations", "business", "workflow",
];

export const AGENT_FILTER_OPTIONS: (AgentName | "unassigned")[] = [
  "riley", "jordan", "avery", "casey", "brian", "unassigned",
];

export const PRIORITIES: TaskPriority[] = ["high", "medium", "low"];

export const SOURCES: WorkItemSource[] = [
  "manual", "casey_audit", "sprint_plan", "sprint",
  "agent_suggestion", "backlog_migration", "typeform", "stripe",
];

export const ITEM_TYPES: WorkItemType[] = ["internal", "client"];
export type ItemTypeFilter = WorkItemType | "all";
export const ITEM_TYPE_FILTERS: ItemTypeFilter[] = ["internal", "client", "all"];

export const STATUS_PILL: Record<WorkStatus, string> = {
  inbox:        "bg-gray-100 text-gray-700",
  approved:     "bg-blue-100 text-blue-700",
  prompt_ready: "bg-violet-100 text-violet-700",
  in_progress:  "bg-amber-100 text-amber-700",
  open:         "bg-slate-100 text-slate-700",
  on_hold:      "bg-indigo-100 text-indigo-700",
  done:         "bg-green-100 text-green-700",
  deferred:     "bg-yellow-100 text-yellow-800",
  cancelled:    "bg-gray-200 text-gray-600",
  rejected:     "bg-red-100 text-red-700",
};

export const STATUS_LABEL: Record<WorkStatus, string> = {
  inbox:        "Inbox",
  approved:     "Approved",
  prompt_ready: "Prompt ready",
  in_progress:  "In progress",
  open:         "Open",
  on_hold:      "On hold",
  done:         "Done",
  deferred:     "Deferred",
  cancelled:    "Cancelled",
  rejected:     "Rejected",
};

export const ALL_STATUSES: WorkStatus[] = [
  "inbox", "approved", "prompt_ready", "in_progress",
  "open", "on_hold", "done", "deferred", "cancelled", "rejected",
];
