export type TaskStatus = "open" | "in_progress" | "deferred" | "done" | "cancelled";
export type TaskPriority = "high" | "medium" | "low";
export type Agent = "riley" | "jordan" | "avery" | "brian" | "sam";

export interface Task {
  id: string;
  created_at: string;
  updated_at: string;
  title: string;
  description?: string;
  assigned_agent: Agent;
  priority: TaskPriority;
  due_date?: string;
  status: TaskStatus;
  category?: string;
  notes?: string;
  completed_at?: string;
}

export interface WorkflowLog {
  id: string;
  created_at: string;
  workflow_name: string;
  workflow_id?: string;
  execution_id?: string;
  agent: Agent;
  trigger_text?: string;
  status: "success" | "error" | "pending";
  error_message?: string;
  duration_ms?: number;
}

export interface PendingApproval {
  id: string;
  created_at: string;
  expires_at?: string;
  agent: Agent;
  action_type: string;
  title: string;
  description?: string;
  payload?: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "expired";
}

export interface Lead {
  id: string;
  created_at: string;
  updated_at: string;
  source?: string;
  org_name?: string;
  contact_name?: string;
  title?: string;
  email?: string;
  phone?: string;
  stated_need?: string;
  budget_signal?: string;
  urgency?: string;
  status: "new" | "qualified" | "proposal" | "client" | "lost";
  notes?: string;
}

export interface Client {
  id: string;
  created_at: string;
  updated_at: string;
  org_name: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  tier?: string;
  onboard_date?: string;
  status: "active" | "churned" | "paused";
  assigned_agents?: Agent[];
  notes?: string;
  lead_id?: string;
}

export interface ContentIdea {
  id: string;
  created_at: string;
  title: string;
  description?: string;
  source?: string;
  signal_type: "blog_topic" | "competitor_gap" | "service_improvement" | "competitive_intel";
  priority: TaskPriority;
  status: "queued" | "in_progress" | "published" | "discarded";
  post_id?: number;
}

// Tool enhancement backlog
export type BacklogStatus =
  | "inbox"
  | "approved"
  | "bundled"
  | "prompt_ready"
  | "in_progress"
  | "done"
  | "rejected";

export type BacklogArea =
  | "workflow"
  | "dashboard"
  | "content"
  | "infrastructure"
  | "agent";

export type BacklogSuggester = "riley" | "avery" | "jordan" | "brian";

export interface BacklogItem {
  id: number;
  created_at: string;
  suggested_by: BacklogSuggester;
  title: string;
  summary: string;
  problem_detail?: string | null;
  affected_area: BacklogArea;
  status: BacklogStatus;
  bundle_id?: number | null;
  priority?: TaskPriority | null;
  claude_code_prompt?: string | null;
  arch_notes?: string | null;
  approved_at?: string | null;
  prompt_ready_at?: string | null;
}

// Dashboard summary types
export interface AgentStatus {
  agent: Agent;
  executions_24h: number;
  errors_24h: number;
  last_execution?: string;
  last_status?: "success" | "error" | "pending";
}

export interface DashboardStats {
  pending_approvals: number;
  open_tasks: number;
  overdue_tasks: number;
  executions_today: number;
  errors_today: number;
  content_queue: number;
}
