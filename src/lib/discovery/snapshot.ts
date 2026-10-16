import { z } from "zod";
import {
  DiscoveryFieldDef, DiscoveryInvite, DiscoveryProjectType, DiscoveryQuestion, DiscoveryQuestionnaireDef,
  DiscoverySectionDef, DiscoveryTemplate, DiscoveryTemplateItem,
} from "@/types";

// Pure helpers for questionnaire snapshots: the frozen definition stored on each
// invite (crm.discovery_invites.questionnaire_snapshot). Same shape as the
// website's questionnaire-v1.json, so the form, the brief and the dashboard all
// read old and new invites the same way.

export const QUESTION_TYPES: { value: DiscoveryFieldDef["type"]; label: string; creatable: boolean }[] = [
  { value: "text",      label: "Short text",      creatable: true },
  { value: "textarea",  label: "Long text",       creatable: true },
  { value: "single",    label: "Single choice",   creatable: true },
  { value: "multi",     label: "Multiple choice", creatable: true },
  { value: "scale",     label: "1–5 scale",       creatable: true },
  { value: "yes_no",    label: "Yes / no",        creatable: true },
  { value: "email",     label: "Email",           creatable: false },
  { value: "tool_rows", label: "Table rows",      creatable: false },
];

export const CHOICE_TYPES = new Set(["single", "multi"]);

export function questionToField(q: DiscoveryQuestion, item?: Pick<DiscoveryTemplateItem, "required" | "show_if">): DiscoveryFieldDef {
  const f: DiscoveryFieldDef = { ...(q.config ?? {}), id: q.key, type: q.type, label: q.label };
  if (q.help) f.help = q.help;
  const required = item?.required ?? q.required;
  if (required) f.required = true;
  if (q.options?.length) f.options = q.options;
  if (q.type === "scale") { f.min ??= 1; f.max ??= 5; }
  if (item?.show_if) f.showIf = item.show_if;
  return f;
}

/** Build the snapshot an invite starts from: template order, filtered to the project type. */
export function buildSnapshot(
  template: Pick<DiscoveryTemplate, "id" | "name" | "intro_text" | "estimated_minutes" | "sections">,
  items: (DiscoveryTemplateItem & { question: DiscoveryQuestion })[],
  projectType: DiscoveryProjectType,
): DiscoveryQuestionnaireDef {
  const applicable = [...items]
    .sort((a, b) => a.position - b.position)
    .filter(i => !i.project_types?.length || i.project_types.includes(projectType));
  const sections: DiscoverySectionDef[] = template.sections.map(s => ({
    id: s.id,
    title: s.title,
    ...(s.intro ? { intro: s.intro } : {}),
    fields: applicable.filter(i => i.section_id === s.id).map(i => questionToField(i.question, i)),
  }));
  // Items whose section was removed from the template still go somewhere visible.
  const known = new Set(template.sections.map(s => s.id));
  const orphans = applicable.filter(i => !known.has(i.section_id));
  if (orphans.length) sections.push({ id: "more", title: "More questions", fields: orphans.map(i => questionToField(i.question, i)) });
  return dropDanglingShowIf({
    version: `template:${template.id}`,
    title: template.name,
    estimated_minutes: template.estimated_minutes ?? undefined,
    intro: template.intro_text ?? undefined,
    template: { id: template.id, name: template.name },
    sections: sections.filter(s => s.fields.length),
  });
}

/** Sections the respondent actually sees: v1 snapshots carry project-type `modules`. */
export function visibleSections(def: DiscoveryQuestionnaireDef | null | undefined, projectType: DiscoveryProjectType): DiscoverySectionDef[] {
  return def?.sections.filter(s => !s.modules?.length || s.modules.includes(projectType)) ?? [];
}

/** The definition the respondent was (or will be) shown. Older rows only have it on the response. */
export function resolveSnapshot(invite: Pick<DiscoveryInvite, "questionnaire_snapshot" | "response">): DiscoveryQuestionnaireDef | null {
  return invite.questionnaire_snapshot ?? invite.response?.schema_snapshot ?? null;
}

export function allFields(def: DiscoveryQuestionnaireDef): DiscoveryFieldDef[] {
  return def.sections.flatMap(s => s.fields);
}

/** Fields whose showIf points at `fieldId`: removing it would hide them forever. */
export function dependentsOf(def: DiscoveryQuestionnaireDef, fieldId: string): DiscoveryFieldDef[] {
  return allFields(def).filter(f => f.showIf?.field === fieldId);
}

/** A showIf whose target is gone would hide its question for good; drop the condition instead. */
export function dropDanglingShowIf(def: DiscoveryQuestionnaireDef): DiscoveryQuestionnaireDef {
  const ids = new Set(allFields(def).map(f => f.id));
  return {
    ...def,
    sections: def.sections.map(s => ({
      ...s,
      fields: s.fields.map(f => {
        if (!f.showIf || ids.has(f.showIf.field)) return f;
        const { showIf: _drop, ...rest } = f;
        return rest;
      }),
    })),
  };
}

export function slugify(s: string, max = 40): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, max) || "item";
}

/** A unique answer key for a one-off question. */
export function customKey(label: string, taken: Iterable<string>, rand: () => string = () => Math.random().toString(36).slice(2, 6)): string {
  const used = new Set(taken);
  const base = `custom_${slugify(label, 30)}`;
  if (!used.has(base) && /^[a-z]/.test(base)) return base;
  let k: string;
  do { k = `${base}_${rand()}`; } while (used.has(k));
  return k;
}

/** Rough minutes to complete, for the welcome screen. */
export function estimateMinutes(def: DiscoveryQuestionnaireDef): number {
  const secs = allFields(def).reduce((t, f) => t + (f.type === "textarea" || f.type === "tool_rows" ? 60 : 20), 0);
  return Math.max(3, Math.round(secs / 60));
}

// ── Validation for snapshots edited in the dashboard ────────────────────────────

const ShowIf = z.object({ field: z.string(), in: z.array(z.string()).optional(), notIn: z.array(z.string()).optional() });

const Field = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/, "Question keys must be lowercase letters, digits and _"),
  type: z.enum(["text", "textarea", "single", "multi", "scale", "yes_no", "email", "tool_rows"]),
  label: z.string().trim().min(1).max(500),
  help: z.string().max(1000).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(200)).max(40).optional(),
  showIf: ShowIf.optional(),
}).passthrough().superRefine((f, ctx) => {
  if (CHOICE_TYPES.has(f.type) && !(f.options?.length)) ctx.addIssue({ code: "custom", message: `“${f.label}” needs at least one option` });
});

export const SnapshotSchema = z.object({
  version: z.string().max(100),
  title: z.string().max(200),
  estimated_minutes: z.number().int().min(1).max(120).optional(),
  intro: z.string().max(4000).optional(),
  template: z.object({ id: z.string(), name: z.string() }).optional(),
  project_types: z.record(z.string(), z.string()).optional(),
  sections: z.array(z.object({
    id: z.string().min(1).max(60),
    title: z.string().trim().min(1).max(200),
    intro: z.string().max(2000).optional(),
    modules: z.array(z.string()).optional(),
    fields: z.array(Field).max(150),
  }).passthrough()).max(40),
}).superRefine((d, ctx) => {
  const ids = d.sections.flatMap(s => s.fields.map(f => f.id));
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) ctx.addIssue({ code: "custom", message: `Question key “${dup}” is used twice` });
  if (!ids.length) ctx.addIssue({ code: "custom", message: "The questionnaire has no questions" });
});
