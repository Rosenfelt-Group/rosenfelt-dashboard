import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { countByStatus, orgStatus, parseOrgStatusFilter, todayNY, type OrgStatus } from "@/lib/crm/org-status";
import { isOpenDeal } from "@/lib/crm/org-engagement";
import type { CRMStage } from "@/types";
import type { OrgListRow } from "@/lib/crm/org-detail";


type Biz = { id: string; name: string; industry: string | null; website: string | null; email: string | null; size: string | null; source: string | null; relationship: string | null; updated_at: string };
type Client = { id: string; business_id: string | null; billing_status: string | null; contract_end: string | null; updated_at: string; services: { status: string }[] | null };
type Lead = { id: string; business_id: string | null; stage: CRMStage; estimated_value: number | null; created_at: string; updated_at: string };
type Contact = { business_id: string | null; first_name: string | null; last_name: string | null; email: string | null };

const latest = (...ts: (string | null | undefined)[]) => ts.filter(Boolean).sort().pop()!;

/**
 * GET /api/crm/organizations?status=prospect|client|past_client|partner|all&q=…
 *   -> { organizations: OrgListRow[], counts: { all, prospect, client, past_client, partner } }
 * Counts are for the search alone (before the status filter), so the status pills show what each would list.
 * Search matches the name, website, email and industry, and the names and emails of the people there.
 */
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const sp = req.nextUrl.searchParams;
  const status = parseOrgStatusFilter(sp.get("status"));
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const crm = supabaseAdmin.schema("crm");

  const [b, c, l, p] = await Promise.all([
    crm.from("businesses").select("id, name, industry, website, email, size, source, relationship, updated_at")
      .is("deleted_at", null).order("name"),
    crm.from("clients").select("id, business_id, billing_status, contract_end, updated_at, services:client_services(status)")
      .is("deleted_at", null),
    crm.from("leads").select("id, business_id, stage, estimated_value, created_at, updated_at").is("deleted_at", null),
    crm.from("contacts").select("business_id, first_name, last_name, email").is("deleted_at", null).not("business_id", "is", null),
  ]);
  const failed = [b, c, l, p].find((r) => r.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });

  const group = <T extends { business_id: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) if (r.business_id) m.set(r.business_id, [...(m.get(r.business_id) ?? []), r]);
    return m;
  };
  const clients = group((c.data ?? []) as Client[]);
  const leads = group((l.data ?? []) as Lead[]);
  const people = group((p.data ?? []) as Contact[]);
  const today = todayNY();

  const rows: OrgListRow[] = [];
  for (const biz of (b.data ?? []) as Biz[]) {
    const bc = clients.get(biz.id) ?? [];
    const bl = leads.get(biz.id) ?? [];
    const bp = people.get(biz.id) ?? [];
    if (q) {
      const hay = [biz.name, biz.website, biz.email, biz.industry, ...bp.flatMap((x) => [x.first_name, x.last_name, x.email])]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) continue;
    }
    const open = bl.filter(isOpenDeal).sort((x, y) => y.created_at.localeCompare(x.created_at));
    rows.push({
      id: biz.id, name: biz.name, industry: biz.industry, website: biz.website, email: biz.email, size: biz.size, source: biz.source,
      status: orgStatus(biz.relationship, bc.map((x) => ({ ...x, services: x.services ?? [] })), today),
      relationship_override: biz.relationship,
      people: bp.length, clients: bc.length, deals: bl.length,
      open_deals: open.length, open_value: open.reduce((s, x) => s + (Number(x.estimated_value) || 0), 0),
      open_deal: open[0] ? { id: open[0].id, stage: open[0].stage, estimated_value: open[0].estimated_value } : null,
      last_activity_at: latest(biz.updated_at, ...bl.map((x) => x.updated_at), ...bc.map((x) => x.updated_at)),
    });
  }

  const counts = countByStatus(rows);
  const organizations = (status === "all" ? rows : rows.filter((r) => r.status === status))
    .sort((x, y) => y.last_activity_at.localeCompare(x.last_activity_at));
  return NextResponse.json({ organizations, counts });
}
