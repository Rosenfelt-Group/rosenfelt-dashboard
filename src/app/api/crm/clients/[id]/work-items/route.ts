import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/crm/clients/[id]/work-items
// Lists public.work_items WHERE client_id = id AND work_item_type = 'client'
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from("work_items")
    .select("*")
    .eq("client_id", id)
    .eq("work_item_type", "client")
    .eq("archived", false)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("client work-items list:", error);
    return NextResponse.json([], { status: 500 });
  }
  return NextResponse.json(data ?? []);
}
