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
