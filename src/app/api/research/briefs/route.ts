import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type BriefOrgLink = { business_id: string; name: string };

/** Library briefs, newest first, each with the organizations it is linked to (`links`). */
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("research_briefs")
    .select("id, topic, research_type, category, doc_id, storage_path, query_count, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("research_briefs fetch error:", error);
    return NextResponse.json([], { status: 500 });
  }
  const briefs = (data ?? []) as { id: string }[];
  const links = new Map<string, BriefOrgLink[]>();
  if (briefs.length) {
    const { data: rows, error: lErr } = await supabaseAdmin.from("research_brief_links")
      .select("brief_id, business_id").in("brief_id", briefs.map(b => b.id));
    if (lErr) console.error("research_brief_links fetch error:", lErr);
    const linkRows = (rows ?? []) as { brief_id: string; business_id: string }[];
    const bizIds = [...new Set(linkRows.map(r => r.business_id))];
    const names = new Map<string, string>();
    if (bizIds.length) {
      const { data: biz, error: bzErr } = await supabaseAdmin.schema("crm").from("businesses")
        .select("id, name").in("id", bizIds).is("deleted_at", null);
      if (bzErr) console.error("businesses fetch error:", bzErr);
      for (const b of (biz ?? []) as { id: string; name: string }[]) names.set(b.id, b.name);
    }
    for (const r of linkRows) {
      const name = names.get(r.business_id);
      if (!name) continue;
      links.set(r.brief_id, [...(links.get(r.brief_id) ?? []), { business_id: r.business_id, name }]);
    }
  }
  return NextResponse.json(briefs.map(b => ({
    ...b,
    links: (links.get(b.id) ?? []).sort((x, y) => x.name.localeCompare(y.name)),
  })));
}
