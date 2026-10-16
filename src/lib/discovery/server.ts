import { supabaseAdmin } from "@/lib/supabase-admin";
import { DiscoveryProjectType, DiscoveryQuestion, DiscoveryQuestionnaireDef, DiscoveryTemplate, DiscoveryTemplateItem } from "@/types";
import { buildSnapshot } from "./snapshot";

// Server-side reads for the question bank and templates (service role only).

export const QUESTION_SELECT = "id, key, label, help, section, type, options, required, config, archived_at, created_at, updated_at";
const ITEM_SELECT = `id, question_id, position, section_id, required, project_types, show_if, question:discovery_questions(${QUESTION_SELECT})`;

export type TemplateWithItems = Omit<DiscoveryTemplate, "items"> & { items: (DiscoveryTemplateItem & { question: DiscoveryQuestion })[] };

export async function loadTemplate(id: string): Promise<TemplateWithItems | null> {
  const { data, error } = await supabaseAdmin.schema("crm").from("discovery_templates")
    .select(`*, items:discovery_template_items(${ITEM_SELECT})`)
    .eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const t = data as unknown as TemplateWithItems;
  t.items = [...(t.items ?? [])].sort((a, b) => a.position - b.position);
  return t;
}

export async function defaultTemplateId(): Promise<string | null> {
  const { data } = await supabaseAdmin.schema("crm").from("discovery_templates")
    .select("id").eq("is_default", true).is("archived_at", null).maybeSingle();
  return data?.id ?? null;
}

/** A fresh snapshot for a draft invite, from a template filtered to the project type. */
export async function snapshotFromTemplate(templateId: string, projectType: DiscoveryProjectType): Promise<DiscoveryQuestionnaireDef | null> {
  const t = await loadTemplate(templateId);
  if (!t || t.archived_at) return null;
  return buildSnapshot(t, t.items.filter(i => !!i.question), projectType);
}
