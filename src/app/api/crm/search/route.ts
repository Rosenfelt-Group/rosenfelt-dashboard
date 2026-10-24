import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { stageMeta } from "@/lib/crm/stages";
import { contactSearchFilter, EMPTY_RESULTS, ilikeAny, parseLimit, parseSearchQuery, type SearchResults } from "@/lib/crm/search";
import type { CRMStage } from "@/types";

type Named = { id: string; name: string } | null;
type PersonName = { first_name: string; last_name: string | null } | null;
const personName = (p: PersonName) => (p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : "");

// The candidate pool per record type. Deals are found through the matching organizations and people,
// so the pool is larger than what is shown.
const POOL = 25;

// GET /api/crm/search?q=&limit= — ⌘K search over organizations (crm.businesses), people
// (crm.contacts) and deals (crm.leads). Soft-deleted rows are left out.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const params = new URL(req.url).searchParams;
  const q = parseSearchQuery(params.get("q"));
  const limit = parseLimit(params.get("limit"), 5, 20);
  if (!q) return NextResponse.json(EMPTY_RESULTS);

  const crm = supabaseAdmin.schema("crm");
  const [biz, people] = await Promise.all([
    crm.from("businesses").select("id, name, website").is("deleted_at", null)
      .or(ilikeAny(["name", "website", "email"], q)).order("name").limit(POOL),
    crm.from("contacts").select("id, first_name, last_name, email, business:businesses(id, name)").is("deleted_at", null)
      .or(contactSearchFilter(q)).order("first_name").limit(POOL),
  ]);
  const failed = biz.error ?? people.error;
  if (failed) {
    console.error("crm search failed:", failed.message);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
  const bizRows = (biz.data ?? []) as { id: string; name: string; website: string | null }[];
  const personRows = (people.data ?? []) as unknown as { id: string; first_name: string; last_name: string | null; email: string | null; business: Named }[];

  const ids = (xs: { id: string }[]) => xs.map(x => x.id).join(",");
  const dealFilter = [
    bizRows.length && `business_id.in.(${ids(bizRows)})`,
    personRows.length && `contact_id.in.(${ids(personRows)})`,
  ].filter(Boolean).join(",");

  let dealRows: { id: string; stage: CRMStage; estimated_value: number | null; business: Named; contact: PersonName }[] = [];
  if (dealFilter) {
    const deals = await crm.from("leads")
      .select("id, stage, estimated_value, business:businesses(id, name), contact:contacts(first_name, last_name)")
      .is("deleted_at", null).or(dealFilter).order("updated_at", { ascending: false }).limit(limit);
    if (deals.error) {
      console.error("crm search (deals) failed:", deals.error.message);
      return NextResponse.json({ error: "Search failed" }, { status: 500 });
    }
    dealRows = (deals.data ?? []) as unknown as typeof dealRows;
  }

  const results: SearchResults = {
    organizations: bizRows.slice(0, limit).map(b => ({
      id: b.id, label: b.name, detail: b.website, href: `/crm/organizations/${b.id}`,
    })),
    people: personRows.slice(0, limit).map(p => ({
      id: p.id,
      label: personName(p) || p.email || "Unnamed",
      detail: [p.business?.name, p.email].filter(Boolean).join(" · ") || null,
      href: `/crm/people/${p.id}`,
    })),
    deals: dealRows.map(d => ({
      id: d.id,
      label: [d.business?.name ?? "Unknown organization", personName(d.contact)].filter(Boolean).join(" — "),
      detail: [stageMeta(d.stage)?.label ?? d.stage, d.estimated_value ? `$${Number(d.estimated_value).toLocaleString("en-US")}` : null]
        .filter(Boolean).join(" · "),
      href: `/crm/leads/${d.id}`,
    })),
  };
  return NextResponse.json(results);
}
