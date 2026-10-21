import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ lead_id: string }> }
) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { lead_id } = await params;
  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("assessment_results")
    .select("*")
    .eq("lead_id", lead_id)
    .maybeSingle();
  if (error) return NextResponse.json(null, { status: 500 });
  return NextResponse.json(data);
}
