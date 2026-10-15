import { z } from "zod";

export const RELATIONSHIPS = ["prospect", "client", "partner"] as const;

// Agents that have the publish_prototype_version tool. Add names as the tool is replicated.
export const PROTOTYPE_AGENTS = ["casey"] as const;

export const CreateEngagementSchema = z.object({
  business_id: z.string().uuid(),
  relationship: z.enum(RELATIONSHIPS),
  title: z.string().trim().min(1).max(200),
  lead_id: z.string().uuid().optional(),
  client_id: z.string().uuid().optional(),
  modules: z.object({ discovery: z.boolean(), solutions: z.boolean() })
    .default({ discovery: false, solutions: true }),
});

export const IssueAccessSchema = z.object({
  label: z.string().trim().max(100).optional(),
  expires_days: z.number().int().min(1).max(365).default(60),
});

export const PrototypeRequestSchema = z.object({
  agent: z.enum(PROTOTYPE_AGENTS),
  brief: z.string().trim().min(1).max(10000),
  deliverable_id: z.string().uuid().optional(),
  deliverable_title: z.string().trim().min(1).max(200).optional(),
}).refine(b => Boolean(b.deliverable_id) !== Boolean(b.deliverable_title), {
  message: "Provide either an existing deliverable or a new deliverable title.",
});

export const RefreshAccessSchema = z.object({
  expires_days: z.number().int().min(1).max(365).default(60),
});

export const WELCOME_MAX = 1000;

// Plain text only: CRLF/CR -> LF, control characters other than LF and TAB removed, trimmed; empty -> null.
export function normalizeWelcome(raw: string | null): string | null {
  if (raw === null) return null;
  const s = raw.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").trim();
  return s === "" ? null : s;
}

export const DeliverablePatchSchema = z.strictObject({
  welcome_message: z.string().max(5000).nullable().transform(normalizeWelcome)
    .refine(v => v === null || v.length <= WELCOME_MAX, { message: `Welcome message must be ${WELCOME_MAX} characters or fewer.` }),
});
