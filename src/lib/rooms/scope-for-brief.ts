// src/lib/rooms/scope-for-brief.ts
//
// The current scope document for an engagement, filtered for the prototype builder (Casey).
// Casey design-only plan, Task 9 (2026-10-24): prototypes build from the scope, not the raw discovery answers.
//
// Casey sees every section marked visibility='client' plus four internal sections that are design inputs.
// It NEVER sees the other internal sections (fit_assessment, risks_and_constraints, gaps_and_contradictions,
// questions_for_the_first_call, or any custom internal section): those are Rosably's own assessment.

export const SCOPE_DESIGN_INTERNAL_KEYS = [
  "current_state",
  "where_the_time_goes",
  "quick_wins_first_30_days",
  "bigger_opportunities",
] as const;

export const SCOPE_SECTION_CAP = 4000;

export type ScopeSectionForBrief = { key: string; title: string; body_md: string };

export type ScopeForBrief = {
  title: string;
  engagementType: string | null;
  deliveryModel: string | null;
  versionNo: number;
  sections: ScopeSectionForBrief[];
};

const DESIGN_INTERNAL = new Set<string>(SCOPE_DESIGN_INTERNAL_KEYS);

/** The sections the builder may see, in document order, each body capped. Malformed or empty ones are dropped. */
export function sectionsForBuilder(sections: unknown): ScopeSectionForBrief[] {
  if (!Array.isArray(sections)) return [];
  const out: ScopeSectionForBrief[] = [];
  for (const s of sections) {
    if (!s || typeof s !== "object") continue;
    const { key, title, body_md, visibility } = s as Record<string, unknown>;
    if (typeof key !== "string" || typeof body_md !== "string" || !body_md.trim()) continue;
    const allowed = visibility === "client" || (visibility === "internal" && DESIGN_INTERNAL.has(key));
    if (!allowed) continue;
    const body = body_md.length > SCOPE_SECTION_CAP ? `${body_md.slice(0, SCOPE_SECTION_CAP)}\n[truncated]` : body_md;
    out.push({ key, title: typeof title === "string" && title.trim() ? title : key, body_md: body });
  }
  return out;
}

type EngagementRef = { id: string; business_id: string; lead_id: string | null; client_id: string | null };

/**
 * The engagement's scope document: by engagement_id, then (business_id, lead_id), then (business_id, client_id),
 * newest first, and only one that has a current version. Null when there is none (the brief then falls back
 * to the discovery answers).
 */
export async function findScopeForEngagement(eng: EngagementRef): Promise<ScopeForBrief | null> {
  const { supabaseAdmin } = await import("@/lib/supabase-admin");
  const crm = supabaseAdmin.schema("crm");

  const lookups: [string, string][][] = [[["engagement_id", eng.id]]];
  if (eng.lead_id) lookups.push([["business_id", eng.business_id], ["lead_id", eng.lead_id]]);
  if (eng.client_id) lookups.push([["business_id", eng.business_id], ["client_id", eng.client_id]]);

  for (const filters of lookups) {
    let q = crm.from("scope_documents")
      .select("title, engagement_type, delivery_model, current_version_id")
      .not("current_version_id", "is", null)
      .is("deleted_at", null);
    for (const [col, val] of filters) q = q.eq(col, val);
    const { data: doc, error } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!doc) continue;

    const { data: version, error: vErr } = await crm.from("scope_versions")
      .select("version_no, sections").eq("id", doc.current_version_id).maybeSingle();
    if (vErr) throw vErr;
    if (!version) continue;

    return {
      title: doc.title,
      engagementType: doc.engagement_type ?? null,
      deliveryModel: doc.delivery_model ?? null,
      versionNo: version.version_no,
      sections: sectionsForBuilder(version.sections),
    };
  }
  return null;
}
