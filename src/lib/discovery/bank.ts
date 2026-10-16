import { z } from "zod";
import { DiscoveryFieldDef, DiscoveryQuestion } from "@/types";
import { CHOICE_TYPES } from "./snapshot";

// Validation for question-bank rows, shared by the API and the editor.

const CREATABLE = ["text", "textarea", "single", "multi", "scale", "yes_no"] as const;

const Config = z.object({
  other: z.boolean().optional(),
  placeholder: z.string().max(300).optional(),
  max: z.number().int().min(1).max(40).optional(),
  min: z.number().int().optional(),
  minLabel: z.string().max(100).optional(),
  maxLabel: z.string().max(100).optional(),
  followUpOn: z.string().max(10).optional(),
  followUpLabel: z.string().max(300).optional(),
}).passthrough();

export const QuestionInputSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/, "Keys are lowercase letters, digits and _ (2–63 chars)").optional(),
  label: z.string().trim().min(1, "Question text is required").max(500),
  help: z.string().trim().max(1000).nullable().optional(),
  section: z.string().trim().min(1).max(120).default("General"),
  // Legacy types (email, tool_rows) exist in the bank but can only be edited, not created.
  type: z.enum(["text", "textarea", "single", "multi", "scale", "yes_no", "email", "tool_rows"]),
  options: z.array(z.string().trim().min(1).max(200)).max(40).nullable().optional(),
  required: z.boolean().default(false),
  config: Config.default({}),
}).superRefine((q, ctx) => {
  if (CHOICE_TYPES.has(q.type) && !q.options?.length) ctx.addIssue({ code: "custom", message: "Choice questions need at least one option", path: ["options"] });
});

export type QuestionInput = z.infer<typeof QuestionInputSchema>;

export function isCreatableType(t: string): t is (typeof CREATABLE)[number] {
  return (CREATABLE as readonly string[]).includes(t);
}

/** Normalize options: choice types keep a de-duplicated list, others drop it. */
export function cleanQuestion(q: QuestionInput): QuestionInput {
  const options = CHOICE_TYPES.has(q.type) ? [...new Set((q.options ?? []).map(o => o.trim()).filter(Boolean))] : null;
  const config = { ...q.config };
  if (q.type !== "yes_no") { delete config.followUpOn; delete config.followUpLabel; }
  if (!CHOICE_TYPES.has(q.type)) delete config.other;
  if (q.type !== "multi" && q.type !== "scale") delete config.max;
  if (q.type !== "scale") { delete config.min; delete config.minLabel; delete config.maxLabel; }
  return { ...q, options, config };
}

/** A bank row for a one-off question written in the draft editor. */
export function questionFromField(f: DiscoveryFieldDef, section: string): QuestionInput {
  const { id, type, label, help, required, options, showIf: _s, ...config } = f;
  return cleanQuestion({ key: id, type, label, help: help ?? null, required: !!required, options: options ?? null, section, config: config as QuestionInput["config"] });
}

export function questionSearchText(q: Pick<DiscoveryQuestion, "label" | "key" | "section" | "help">): string {
  return `${q.label} ${q.key} ${q.section} ${q.help ?? ""}`.toLowerCase();
}
