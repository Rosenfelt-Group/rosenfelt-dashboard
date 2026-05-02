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
  doc_path?: string | null;
}

// RBAC
export interface DashboardRole {
  name: string;
  description: string;
  permissions: string[];
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

// ─── CRM Types ────────────────────────────────────────────────────────────────

export type CRMStage = "new" | "qualification" | "engaged" | "proposal" | "won" | "lost";
export type CRMSource = "website_contact" | "website_assessment" | "manual" | "referral";
export type CRMActivityType = "note" | "email_sent" | "email_received" | "stage_change" | "assessment" | "system";
export type CRMBillingStatus = "active" | "paused" | "cancelled";
export type CRMServiceTier = "newsroom" | "operations" | "finance_ops" | "growth_stack" | "full_stack";
export type CRMAssessmentTier = "foundation_first" | "getting_there" | "ready_light_prep" | "ready_to_move";

export interface CRMBusiness {
  id: string;
  name: string;
  industry?: string;
  size?: "1-10" | "11-50" | "51-200" | "200+";
  website?: string;
  source?: CRMSource;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface CRMContact {
  id: string;
  business_id?: string;
  first_name: string;
  last_name?: string;
  email?: string;
  phone?: string;
  title?: string;
  is_primary: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
  business?: CRMBusiness;
}

export interface CRMLead {
  id: string;
  business_id: string;
  contact_id?: string;
  stage: CRMStage;
  source?: CRMSource;
  assigned_agent?: Agent;
  estimated_value?: number;
  close_date?: string;
  lost_reason?: string;
  converted_at?: string;
  created_at: string;
  updated_at: string;
  business?: CRMBusiness;
  contact?: CRMContact;
}

export interface CRMActivity {
  id: string;
  lead_id: string;
  activity_type: CRMActivityType;
  content?: string;
  logged_by?: string;
  email_subject?: string;
  email_direction?: "sent" | "received";
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface CRMClient {
  id: string;
  lead_id?: string;
  business_id: string;
  contact_id?: string;
  service_tier?: CRMServiceTier;
  contract_start?: string;
  contract_end?: string;
  billing_status: CRMBillingStatus;
  monthly_value?: number;
  assigned_agents?: string[];
  notes?: string;
  created_at: string;
  updated_at: string;
  business?: CRMBusiness;
  contact?: CRMContact;
}

export interface CRMAssessmentResult {
  id: string;
  lead_id?: string;
  contact_id?: string;
  score: number;
  tier: CRMAssessmentTier;
  section_breakdown?: Record<string, number>;
  submitted_at?: string;
  created_at: string;
}

// ─── Dashboard summary types ───────────────────────────────────────────────────

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
