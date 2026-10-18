// Pure (safe for client import): which message tags the resend route can rebuild.
export const DASHBOARD_RESEND_TAGS = ["dashboard-room-invite", "dashboard-discovery-invite"] as const;
export const RESENDABLE_TAGS = [...DASHBOARD_RESEND_TAGS, "n8n-stripe-buyer", "n8n-typeform-intake"] as const;
export const RERUN_FROM_N8N_TAG = "n8n-avery-deliver-audit";
