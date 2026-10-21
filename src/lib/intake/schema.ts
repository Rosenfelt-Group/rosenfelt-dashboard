import { z } from "zod";

// Keep in sync with crm.intake_lead (docs/migrations/2026-10-22_crm_identity_intake.sql).
export const CHANNELS = [
  "website_contact", "website_assessment", "manual", "referral", "pro_bono", "quiz", "ebook",
  "contact_form", "calendly", "stripe", "typeform", "taproot", "email_inbound",
] as const;
export type IntakeChannel = (typeof CHANNELS)[number];

export const INTAKE_STAGES = [
  "quiz_started", "quiz_completed", "snapshot_viewed", "new", "qualification",
  "engaged", "call_demo_scheduled", "proposal", "won", "lost",
] as const;

const str = z.string().trim().max(2000);

export const IntakeSchema = z.object({
  channel: z.enum(CHANNELS),
  email: str.email(),
  name: str.optional(),
  org: str.optional(),
  phone: str.optional(),
  stage: z.enum(INTAKE_STAGES).optional(),
  entry_stage: z.enum(["quiz_started", "new"]).optional(),
  estimated_value: z.number().finite().nonnegative().max(100_000_000).optional(),
  summary: str.optional(),
  utm_source: str.optional(),
  utm_medium: str.optional(),
  utm_campaign: str.optional(),
  utm_content: str.optional(),
  utm_term: str.optional(),
  referrer: str.optional(),
  landing_path: str.optional(),
  payload: z.record(z.string(), z.unknown()).refine(
    (v) => JSON.stringify(v).length <= 20_000,
    { message: "payload too large (max 20 KB)" },
  ).optional(),
});

export type IntakeInput = z.infer<typeof IntakeSchema>;

export interface IntakeResult {
  contact_id: string;
  business_id: string;
  lead_id: string;
  created_contact: boolean;
  created_lead: boolean;
}

/** Channels each caller identity may submit. */
export const CALLER_CHANNELS: Record<string, readonly IntakeChannel[]> = {
  wordpress: ["quiz", "ebook", "contact_form", "website_contact", "website_assessment"],
  n8n: ["calendly", "stripe", "typeform"],
};

/** Env var holding each caller's bearer secret. */
export const CALLER_SECRET_ENV: Record<string, string> = {
  wordpress: "INTAKE_SECRET_WORDPRESS",
  n8n: "INTAKE_SECRET_N8N",
};
