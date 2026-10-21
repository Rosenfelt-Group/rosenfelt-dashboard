import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";

// GET /api/crm/clients/[id]/services
// Lists all crm.client_services rows for a client, joined with templates.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("client_services")
    .select("*, service_template:service_templates(*)")
    .eq("client_id", id)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("client services list:", error);
    return NextResponse.json([], { status: 500 });
  }
  return NextResponse.json(data ?? []);
}
