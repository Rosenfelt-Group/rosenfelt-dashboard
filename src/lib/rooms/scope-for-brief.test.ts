import { describe, it, expect, vi, beforeEach } from "vitest";

// A tiny fake of supabaseAdmin.schema("crm"): each from() records its filters and returns rows from `db`.
const s = vi.hoisted(() => ({
  docs: [] as Record<string, unknown>[],
  versions: {} as Record<string, Record<string, unknown>>,
  queries: [] as { table: string; filters: Record<string, unknown> }[],
}));
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: () => ({
      from: (table: string) => {
        const filters: Record<string, unknown> = {};
        s.queries.push({ table, filters });
        const chain: Record<string, unknown> = {};
        const rows = () => table === "scope_documents"
          ? s.docs.filter(d => Object.entries(filters).every(([k, v]) =>
            k === "not_null" ? d[v as string] != null : k.startsWith("is:") ? (d[k.slice(3)] ?? null) === v : d[k] === v))
          : Object.values(s.versions).filter(v => v.id === filters.id);
        Object.assign(chain, {
          select: () => chain,
          eq: (k: string, v: unknown) => { filters[k] = v; return chain; },
          not: (k: string) => { filters.not_null = k; return chain; },
          is: (k: string, v: unknown) => { filters[`is:${k}`] = v; return chain; },
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        });
        return chain;
      },
    }),
  },
}));
import { findScopeForEngagement, sectionsForBuilder, SCOPE_SECTION_CAP } from "./scope-for-brief";

export const REAL_KEYS: [string, "client" | "internal"][] = [
  ["snapshot", "client"], ["current_state", "internal"], ["where_the_time_goes", "internal"],
  ["quick_wins_first_30_days", "internal"], ["bigger_opportunities", "internal"], ["risks_and_constraints", "internal"],
  ["gaps_and_contradictions", "internal"], ["questions_for_the_first_call", "internal"], ["proposed_scope", "client"],
  ["fit_assessment", "internal"], ["section-mvlagycw", "internal"],
];
export const realSections = () => REAL_KEYS.map(([key, visibility]) => ({
  key, visibility, title: key.replace(/_/g, " "), body_md: `BODY-OF-${key}`,
}));

const ENG = { id: "e1", business_id: "b1", lead_id: "l1", client_id: "c1" };
beforeEach(() => { s.docs = []; s.versions = {}; s.queries = []; });

describe("sectionsForBuilder", () => {
  it("keeps client sections and the four internal design inputs, nothing else", () => {
    expect(sectionsForBuilder(realSections()).map(x => x.key)).toEqual([
      "snapshot", "current_state", "where_the_time_goes", "quick_wins_first_30_days", "bigger_opportunities",
      "proposed_scope",
    ]);
  });
  it("caps each body and drops empty or malformed sections", () => {
    const out = sectionsForBuilder([
      { key: "snapshot", visibility: "client", title: "S", body_md: "x".repeat(SCOPE_SECTION_CAP + 50) },
      { key: "proposed_scope", visibility: "client", title: "P", body_md: "   " },
      { key: "current_state", visibility: "internal" },
      "nope",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].body_md.length).toBeLessThanOrEqual(SCOPE_SECTION_CAP + 20);
    expect(out[0].body_md.endsWith("[truncated]")).toBe(true);
  });
  it("a section marked client is passed even with an unknown key; an internal unknown key never is", () => {
    const out = sectionsForBuilder([
      { key: "custom-client", visibility: "client", title: "C", body_md: "c" },
      { key: "custom-internal", visibility: "internal", title: "I", body_md: "i" },
    ]);
    expect(out.map(x => x.key)).toEqual(["custom-client"]);
  });
});

describe("findScopeForEngagement", () => {
  const doc = (over: Record<string, unknown>) => ({
    id: "d", business_id: "b1", lead_id: null, client_id: null, engagement_id: null, title: "T",
    engagement_type: "assessment", delivery_model: "fixed", current_version_id: "v", ...over,
  });

  it("scope_lookup_prefers_engagement_then_lead_then_client", async () => {
    s.versions = {
      ve: { id: "ve", version_no: 3, sections: realSections() },
      vl: { id: "vl", version_no: 2, sections: realSections() },
      vc: { id: "vc", version_no: 1, sections: realSections() },
    };
    s.docs = [doc({ id: "dc", client_id: "c1", current_version_id: "vc", title: "by client" }),
              doc({ id: "dl", lead_id: "l1", current_version_id: "vl", title: "by lead" }),
              doc({ id: "de", engagement_id: "e1", current_version_id: "ve", title: "by engagement" })];
    expect((await findScopeForEngagement(ENG))?.title).toBe("by engagement");
    s.docs = s.docs.filter(d => d.id !== "de");
    expect((await findScopeForEngagement(ENG))?.title).toBe("by lead");
    s.docs = s.docs.filter(d => d.id !== "dl");
    const r = await findScopeForEngagement(ENG);
    expect(r).toMatchObject({ title: "by client", versionNo: 1, engagementType: "assessment" });
    expect(r!.sections.map(x => x.key)).not.toContain("fit_assessment");
  });

  it("skips a scope document that is in Trash", async () => {
    s.versions = { v: { id: "v", version_no: 1, sections: realSections() } };
    s.docs = [doc({ engagement_id: "e1", current_version_id: "v", deleted_at: "2026-10-25T00:00:00Z" })];
    expect(await findScopeForEngagement(ENG)).toBeNull();
  });

  it("a lead or client match must be the same business", async () => {
    s.versions = { v: { id: "v", version_no: 1, sections: realSections() } };
    s.docs = [doc({ business_id: "other", lead_id: "l1" })];
    expect(await findScopeForEngagement(ENG)).toBeNull();
  });

  it("returns null without a document or a current version", async () => {
    expect(await findScopeForEngagement(ENG)).toBeNull();
    s.docs = [doc({ engagement_id: "e1", current_version_id: null })];
    expect(await findScopeForEngagement(ENG)).toBeNull();
  });

  it("skips the lead and client lookups when the engagement has neither", async () => {
    await findScopeForEngagement({ ...ENG, lead_id: null, client_id: null });
    expect(s.queries.filter(q => q.table === "scope_documents")).toHaveLength(1);
  });
});
