import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("leads")
    .select("*, business:businesses(*), contact:contacts(*)")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json([], { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const body = await req.json();
  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("leads")
    .insert(body)
    .select("*, business:businesses(*), contact:contacts(*)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
