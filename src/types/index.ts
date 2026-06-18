export type TaskPriority = "high" | "medium" | "low";
export type Agent = "riley" | "jordan" | "avery" | "brian" | "sam" | "casey";

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
  actions_summary?: string;
  session_id?: string;
}

export interface ConversationTurn {
  role: "user" | "assistant" | "tool";
  content: string;
  created_at: string;
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
  status: "pending" | "approved" | "rejected" | "revision_requested" | "expired";
  reviewed_by?: string | null;
  reviewed_at?: string | null;
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
  status: "queued" | "in_progress" | "revision_needed" | "published" | "discarded";
  post_id?: number;
  revision_notes?: string | null;
}

// ─── Unified work items (replaces tasks + tool_backlog conceptually) ──────────

export type WorkType =
  | "infrastructure"
  | "agent"
  | "dashboard"
  | "content"
  | "website"
  | "operations"
  | "business"
  | "workflow"
  | "deliverable"
  | "intake";

export type WorkStatus =
  | "inbox"
  | "approved"
  | "prompt_ready"
  | "in_progress"
  | "open"
  | "on_hold"
  | "done"
  | "deferred"
  | "cancelled"
  | "rejected";

export type WorkItemSource =
  | "manual"
  | "casey_audit"
  | "sprint_plan"
  | "sprint"
  | "agent_suggestion"
  | "backlog_migration"
  | "typeform"
  | "stripe";

export type WorkItemType = "internal" | "client";

export type AgentName = "riley" | "jordan" | "avery" | "casey" | "sam" | "brian";

export interface WorkItem {
  id: string;
  /** Friendly, human-facing sequential id (from 1000). Used in /work/<ref> URLs and the UI. */
  ref: number;
  created_at: string;
  updated_at: string;
  title: string;
  description: string | null;
  summary: string | null;
  work_type: WorkType;
  priority: TaskPriority;
  status: WorkStatus;
  source: WorkItemSource;
  assigned_agent: AgentName | null;
  suggested_by: AgentName | null;
  prompt: string | null;
  arch_notes: string | null;
  due_date: string | null;
  bundle_id: number | null;
  completed_at: string | null;
  approved_at: string | null;
  prompt_ready_at: string | null;
  archived: boolean;
  archived_at: string | null;
  legacy_task_id: string | null;
  legacy_backlog_id: number | null;
  // Added 2026-05-26 (migration: work_items_sprint_client_extensions)
  sprint_number?: number | null;
  // Phase sub-step (text, e.g. "1.0", "1.6", "1.10"). sprint_number is the
  // integer phase for roll-up grouping; phase_step identifies the sub-item
  // within that phase and drives display + sort order.
  phase_step?: string | null;
  work_item_type: WorkItemType;
  client_id?: string | null;
  billable_hours?: number | null;
  client_visible_notes?: string | null;
  // Populated by /api/work GET via DISTINCT ON join (Phase 6); absent on raw inserts.
  last_log?: WorkItemLog | null;
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
  // Added 2026-05-26 (migration: crm_businesses_add_contact_fields)
  address?: string;
  phone?: string;
  email?: string;
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
  contract_start?: string;
  contract_end?: string;
  billing_status: CRMBillingStatus;
  assigned_agents?: string[];
  notes?: string;
  stripe_customer_id?: string;
  created_at: string;
  updated_at: string;
  business?: CRMBusiness;
  contact?: CRMContact;
  // Optional rollups populated by some endpoints
  services?: ClientService[];
  // Deprecated 2026-05-26 — columns were dropped from crm.clients in the
  // work_items_sprint_client_extensions migration. Existing /crm/clients and
  // lead-convert flows still reference these; they're kept here as optional
  // so the legacy code compiles. New code should use ClientService instead.
  service_tier?: CRMServiceTier;
  monthly_value?: number;
  stripe_subscription_id?: string;
  stripe_subscription_status?: string;
}

// ─── Service catalog + per-client services + T&M billing (added 2026-05-26) ──

export type ServiceBillingType = "recurring" | "one_time" | "tm";
export type ServiceBillingInterval = "month" | "quarter" | "year";
export type ClientServiceStatus = "pending_activation" | "active" | "paused" | "cancelled";

export interface ServiceTemplate {
  id: string;
  name: string;
  description: string | null;
  billing_type: ServiceBillingType;
  billing_interval: ServiceBillingInterval | null;
  is_taxable: boolean;
  is_active: boolean;
  stripe_product_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientService {
  id: string;
  client_id: string;
  service_template_id: string;
  monthly_rate: number | null;
  project_rate: number | null;
  hourly_rate: number | null;
  billing_start_date: string | null;
  billing_end_date: string | null;
  status: ClientServiceStatus;
  stripe_subscription_id: string | null;
  stripe_subscription_status: string | null;
  stripe_price_id: string | null;
  billing_activated_at: string | null;
  billing_activated_by: string | null;
  last_billed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Optional joined data
  service_template?: ServiceTemplate;
  client?: CRMClient;
}

export interface TmBillingEntry {
  id: string;
  client_service_id: string;
  work_item_id: string | null;
  entry_date: string;
  hours: number;
  description: string;
  logged_by: string;
  billed: boolean;
  stripe_invoice_id: string | null;
  created_at: string;
  // Optional joined data
  client_service?: ClientService;
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

// ─── SEO keyword tracker ──────────────────────────────────────────────────────

export interface KeywordTracker {
  id: number;
  created_at: string;
  updated_at: string;
  keyword: string | null;
  monthly_volume_est: number | null;
  difficulty: "low" | "medium" | "high";
  tier: "1" | "2" | "3";
  current_position: number | null;
  target_position: number;
  assigned_post_url: string | null;
  status: "planned" | "in_progress" | "published" | "monitoring";
  vertical: string | null;
  notes: string | null;
  last_checked: string | null;
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

// Work item v2 — log stream + doc registry linking
export type WorkItemLogEntryType =
  | "progress"
  | "question"
  | "answer"
  | "note"
  | "error"
  | "completion";

export interface WorkItemLog {
  id: string;
  work_item_id: string;
  created_at: string;
  author: string;
  author_type: "agent" | "human";
  entry_type: WorkItemLogEntryType;
  message: string;
  mentions: string[] | null;
  metadata: Record<string, unknown> | null;
}

export interface WorkItemDoc {
  id: string;
  name: string;
  path: string;
  description: string | null;
  doc_type: string | null;
  audience: string | null;
  updated_at: string | null;
  work_item_id: string;
}
