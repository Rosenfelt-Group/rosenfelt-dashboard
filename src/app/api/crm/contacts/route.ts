import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("contacts")
    .select("*, business:businesses(*)")
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
    .from("contacts")
    .insert(body)
    .select("*, business:businesses(*)")
    .single();
  if (error) {
    if (error.code === "23505" && /email_norm/.test(`${error.message} ${error.details ?? ""}`)) {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const { data: existing } = await supabaseAdmin.schema("crm").from("contacts")
        .select("id").eq("email_norm", email).maybeSingle();
      return NextResponse.json(
        { error: "A contact with this email already exists", existing_contact_id: existing?.id ?? null },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
