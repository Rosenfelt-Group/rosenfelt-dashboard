// Organization research (mockup recommendation 11). An organization's research is its crm.business_research
// notes (Avery's runs and Brian's own notes) plus the library briefs linked to it (public.research_brief_links).
// Brian ticks "Use in scope" per item (crm.scope_research_inputs); nothing is selected by default, and Riley
// only reads the ticked items when it drafts or revises the scope.
import { supabaseAdmin } from "@/lib/supabase-admin";

import type { InputChange, LinkedBrief, OrgResearch, OrgResearchNote } from "./types";

export type { InputChange, LinkedBrief, OrgResearch, OrgResearchNote, ResearchItemType } from "./types";

type Err = { message: string };
export class ResearchError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ResearchError";
  }
}

function fail(error: Err | null, what: string): void {
  if (error) {
    console.error(`org research: ${what}`, error.message);
    throw new ResearchError(500, `Couldn't load ${what}`);
  }
}

/** The business, or null when it does not exist or is in Trash. */
export async function getLiveBusiness(businessId: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await supabaseAdmin.schema("crm").from("businesses")
    .select("id, name").eq("id", businessId).is("deleted_at", null).maybeSingle();
  fail(error, "the organization");
  return (data as { id: string; name: string } | null) ?? null;
}

/**
 * Notes and linked briefs for one business, newest first, each with `selected`. Soft-deleted rows are left
 * out. A linked "business" brief that is the library copy of one of the notes (Avery writes both, with the
 * same document) is left out too, so each piece of research shows once.
 */
export async function loadOrgResearch(businessId: string): Promise<OrgResearch> {
  const crm = supabaseAdmin.schema("crm");
  const [notesRes, linksRes, inputsRes] = await Promise.all([
    crm.from("business_research")
      .select("id, summary, details, source, researched_by, created_at")
      .eq("business_id", businessId).is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabaseAdmin.from("research_brief_links").select("brief_id, created_at").eq("business_id", businessId),
    crm.from("scope_research_inputs").select("business_research_id, research_brief_id").eq("business_id", businessId),
  ]);
  fail(notesRes.error, "research notes");
  fail(linksRes.error, "linked briefs");
  fail(inputsRes.error, "research selections");

  const links = (linksRes.data ?? []) as { brief_id: string; created_at: string }[];
  let briefRows: Omit<LinkedBrief, "type" | "linked_at" | "selected">[] = [];
  if (links.length) {
    const { data, error } = await supabaseAdmin.from("research_briefs")
      .select("id, topic, research_type, category, doc_id, storage_path, created_at")
      .in("id", links.map(l => l.brief_id)).is("deleted_at", null);
    fail(error, "linked briefs");
    briefRows = (data ?? []) as typeof briefRows;
  }

  const inputs = (inputsRes.data ?? []) as { business_research_id: string | null; research_brief_id: string | null }[];
  const selNotes = new Set(inputs.map(i => i.business_research_id).filter(Boolean));
  const selBriefs = new Set(inputs.map(i => i.research_brief_id).filter(Boolean));

  const notes: OrgResearchNote[] = ((notesRes.data ?? []) as Omit<OrgResearchNote, "type" | "selected">[])
    .map(n => ({ type: "note", ...n, selected: selNotes.has(n.id) }));

  const noteDocs = new Set<string>();
  for (const n of notes) {
    const d = n.details ?? {};
    for (const k of ["doc_id", "storage_path"] as const) {
      const v = d[k];
      if (typeof v === "string" && v) noteDocs.add(`${k}:${v}`);
      else if (typeof v === "number") noteDocs.add(`${k}:${v}`);
    }
  }
  const linkedAt = new Map(links.map(l => [l.brief_id, l.created_at]));
  const briefs: LinkedBrief[] = briefRows
    .filter(b => !(b.research_type === "business" &&
      ((b.doc_id && noteDocs.has(`doc_id:${b.doc_id}`)) || (b.storage_path && noteDocs.has(`storage_path:${b.storage_path}`)))))
    .map(b => ({ type: "brief" as const, ...b, linked_at: linkedAt.get(b.id) ?? "", selected: selBriefs.has(b.id) }))
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  const selected_count = notes.filter(n => n.selected).length + briefs.filter(b => b.selected).length;
  return { business_id: businessId, notes, briefs, selected_count, total: notes.length + briefs.length };
}

/** Apply "Use in scope" ticks. Each item must be this business's note or a brief linked to it. */
export async function setResearchInputs(businessId: string, items: InputChange[], addedBy: string): Promise<void> {
  const crm = supabaseAdmin.schema("crm");
  const noteIds = [...new Set(items.filter(i => i.type === "note").map(i => i.id))];
  const briefIds = [...new Set(items.filter(i => i.type === "brief").map(i => i.id))];

  if (noteIds.length) {
    const { data, error } = await crm.from("business_research").select("id")
      .eq("business_id", businessId).in("id", noteIds).is("deleted_at", null);
    fail(error, "research notes");
    if ((data ?? []).length !== noteIds.length) throw new ResearchError(400, "A note does not belong to this organization");
  }
  if (briefIds.length) {
    const { data, error } = await supabaseAdmin.from("research_brief_links").select("brief_id")
      .eq("business_id", businessId).in("brief_id", briefIds);
    fail(error, "linked briefs");
    if ((data ?? []).length !== briefIds.length) throw new ResearchError(400, "A brief is not linked to this organization");
  }

  for (const it of items) {
    const col = it.type === "note" ? "business_research_id" : "research_brief_id";
    if (it.selected) {
      const { error } = await crm.from("scope_research_inputs")
        .upsert({ business_id: businessId, [col]: it.id, added_by: addedBy },
          { onConflict: `business_id,${col}`, ignoreDuplicates: true });
      if (error) { console.error("scope_research_inputs upsert", error.message); throw new ResearchError(500, "Couldn't save the selection"); }
    } else {
      const { error } = await crm.from("scope_research_inputs").delete().eq("business_id", businessId).eq(col, it.id);
      if (error) { console.error("scope_research_inputs delete", error.message); throw new ResearchError(500, "Couldn't save the selection"); }
    }
  }
}

/** How many research items are ticked for a business (Riley refuses a revision with none). */
export async function countSelected(businessId: string): Promise<number> {
  const r = await loadOrgResearch(businessId);
  return r.selected_count;
}

/**
 * Run Avery's organization research (POST <avery>/research/run, synchronous, ~10-30 s). Avery appends a
 * crm.business_research row and also writes a library copy ("business" brief, same document); that copy is
 * linked to the business here (the research_briefs insert trigger links it too when the topic is the name).
 */
export async function runOrgResearch(businessId: string, topic: string): Promise<Record<string, unknown>> {
  const averyUrl = process.env.AVERY_AGENT_URL;
  const secret = process.env.AVERY_WEBHOOK_SECRET;
  if (!averyUrl || !secret) throw new ResearchError(503, "Avery not configured");

  let res: Response;
  try {
    res = await fetch(`${averyUrl.replace(/\/$/, "")}/research/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
      body: JSON.stringify({ business_id: businessId, topic }),
      signal: AbortSignal.timeout(55_000),
    });
  } catch (e) {
    console.error("avery research unreachable", e instanceof Error ? e.name : "error");
    throw new ResearchError(502, "Avery could not be reached. Try again in a minute.");
  }
  const row = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !row) {
    const detail = (row as { detail?: unknown } | null)?.detail;
    console.error("avery research failed", res.status, typeof detail === "string" ? detail.slice(0, 300) : "");
    throw new ResearchError(502, "Research failed. Try again.");
  }

  const details = (row.details ?? {}) as Record<string, unknown>;
  const docId = details.doc_id != null && details.doc_id !== "" ? String(details.doc_id) : null;
  if (docId) {
    const { data } = await supabaseAdmin.from("research_briefs").select("id")
      .eq("research_type", "business").eq("doc_id", docId);
    const ids = ((data ?? []) as { id: string }[]).map(b => b.id);
    if (ids.length) {
      const { error } = await supabaseAdmin.from("research_brief_links")
        .upsert(ids.map(id => ({ brief_id: id, business_id: businessId, linked_by: "avery" })),
          { onConflict: "brief_id,business_id", ignoreDuplicates: true });
      if (error) console.error("research_brief_links upsert after run", error.message);
    }
  }
  return row;
}
