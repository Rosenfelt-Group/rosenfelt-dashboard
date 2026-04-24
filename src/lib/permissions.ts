export const VIEW_PERMISSIONS = [
  "view_overview",
  "view_tasks",
  "view_approvals",
  "view_crm",
  "view_content",
  "view_documents",
  "view_agents",
  "view_intelligence",
  "view_cost",
  "view_backlog",
] as const;

export const MANAGE_PERMISSIONS = [
  "manage_approvals",
  "manage_budget",
  "manage_backlog",
  "use_chat",
  "manage_users",
  "manage_rbac",
] as const;

export const ALL_PERMISSIONS = [...VIEW_PERMISSIONS, ...MANAGE_PERMISSIONS] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  view_overview:    "View Overview",
  view_tasks:       "View Tasks",
  view_approvals:   "View Approvals",
  view_crm:         "View CRM",
  view_content:     "View Content",
  view_documents:   "View Documents",
  view_agents:      "View Agents",
  view_intelligence:"View Intelligence",
  view_cost:        "View Cost",
  view_backlog:     "View Backlog",
  manage_approvals: "Approve / Reject",
  manage_budget:    "Edit Budgets",
  manage_backlog:   "Manage Backlog",
  use_chat:         "Use Chat",
  manage_users:     "Manage Users",
  manage_rbac:      "Manage Roles",
};

export const PERMISSION_GROUPS = {
  view:   VIEW_PERMISSIONS as readonly string[],
  manage: MANAGE_PERMISSIONS as readonly string[],
};

export const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  admin:  [...ALL_PERMISSIONS],
  viewer: [...VIEW_PERMISSIONS],
};

export function can(permissions: string[], permission: string): boolean {
  return permissions.includes(permission);
}
