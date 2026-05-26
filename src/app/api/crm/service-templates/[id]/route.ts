import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/requireAdmin";

// PATCH /api/crm/service-templates/[id]  (admin only)
// Updates a service template. Most useful for flipping is_active on/off and
// editing name/description.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Whitelist of editable fields — anything else is silently dropped.
  const allowed = ["name", "description", "billing_type", "billing_interval", "is_taxable", "is_active", "stripe_product_id"];
  const update: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in body) update[k] = body[k];
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No editable fields in body" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("service_templates")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    console.error("service-templates PATCH:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
