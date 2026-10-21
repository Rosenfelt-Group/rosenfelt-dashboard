import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";

// Find the scope document for a lead or client: GET /api/crm/scope?lead_id=... | ?client_id=...
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const lead = req.nextUrl.searchParams.get("lead_id");
  const client = req.nextUrl.searchParams.get("client_id");
  if (!lead && !client) return NextResponse.json({ error: "lead_id or client_id is required" }, { status: 400 });
  const q = supabaseAdmin.schema("crm").from("scope_documents").select("id, title");
  const { data, error } = await (lead ? q.eq("lead_id", lead) : q.eq("client_id", client!)).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ document: data ?? null });
}
