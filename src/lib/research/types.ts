// Shapes returned by GET /api/crm/businesses/[id]/research (shared by the API and the research components).

export type ResearchItemType = "note" | "brief";

export type OrgResearchNote = {
  type: "note";
  id: string;
  summary: string | null;
  details: Record<string, unknown> | null;
  source: string | null;
  researched_by: string | null;
  created_at: string;
  selected: boolean;
};

export type LinkedBrief = {
  type: "brief";
  id: string;
  topic: string;
  research_type: string;
  category: string | null;
  doc_id: string | null;
  storage_path: string | null;
  created_at: string | null;
  linked_at: string;
  selected: boolean;
};

export type OrgResearch = {
  business_id: string;
  notes: OrgResearchNote[];
  briefs: LinkedBrief[];
  selected_count: number;
  total: number;
};

export type InputChange = { type: ResearchItemType; id: string; selected: boolean };

/** A library brief as GET /api/research/briefs returns it. */
export type LibraryBrief = {
  id: string;
  topic: string;
  research_type: string | null;
  category: string | null;
  doc_id: string | null;
  storage_path: string | null;
  query_count: number | null;
  created_at: string;
  links: { business_id: string; name: string }[];
};
