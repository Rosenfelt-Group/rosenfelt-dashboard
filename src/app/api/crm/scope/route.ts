import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { scopeErrorResponse } from "@/lib/crm/scope-errors";
import { requirePermission } from "@/lib/requirePermission";

// List all: GET /api/crm/scope?list=1
// Find the scope document for a lead or client: GET /api/crm/scope?lead_id=... | ?client_id=...
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  if (req.nextUrl.searchParams.get("list") === "1") {
    const { data, error } = await supabaseAdmin.schema("crm").from("scope_documents")
      .select("id, title, engagement_type, delivery_model, created_at").order("created_at", { ascending: false }).limit(200);
    if (error) return scopeErrorResponse(error);
    return NextResponse.json({ documents: data ?? [] });
  }
  const lead = req.nextUrl.searchParams.get("lead_id");
  const client = req.nextUrl.searchParams.get("client_id");
  if (!lead && !client) return NextResponse.json({ error: "lead_id or client_id is required" }, { status: 400 });
  const q = supabaseAdmin.schema("crm").from("scope_documents").select("id, title");
  const { data, error } = await (lead ? q.eq("lead_id", lead) : q.eq("client_id", client!)).maybeSingle();
  if (error) return scopeErrorResponse(error);
  return NextResponse.json({ document: data ?? null });
}
