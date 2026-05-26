import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/requireAdmin";
import { getStripe } from "@/lib/stripe";

// GET /api/crm/service-templates
// Lists all service templates ordered by name. Used by admin services page +
// the "Add Service to Client" modal on /crm/clients/[id].
export async function GET() {
  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("service_templates")
    .select("*")
    .order("name", { ascending: true });
  if (error) {
    console.error("service-templates GET:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

// POST /api/crm/service-templates  (admin only)
// Creates a new service template AND auto-provisions a Stripe product for it.
// Body: { name, description, billing_type, billing_interval?, is_taxable? }
export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;

  let body: {
    name?: string;
    description?: string;
    billing_type?: string;
    billing_interval?: string;
    is_taxable?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.name || !body.billing_type) {
    return NextResponse.json({ error: "name and billing_type are required" }, { status: 400 });
  }
  if (!["recurring", "one_time", "tm"].includes(body.billing_type)) {
    return NextResponse.json({ error: "billing_type must be recurring, one_time, or tm" }, { status: 400 });
  }
  if (body.billing_type === "recurring" && !body.billing_interval) {
    return NextResponse.json({ error: "billing_interval required for recurring services" }, { status: 400 });
  }

  // Auto-create a Stripe product so the template has a billing handle ready.
  let stripeProductId: string | null = null;
  try {
    const stripe = getStripe();
    const product = await stripe.products.create({
      name: body.name,
      description: body.description ?? undefined,
    });
    stripeProductId = product.id;
  } catch (e) {
    console.error("Stripe product create failed:", e);
    // Don't block template creation — the row can be created without a product
    // and Brian can fix manually later.
  }

  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("service_templates")
    .insert({
      name: body.name,
      description: body.description ?? null,
      billing_type: body.billing_type,
      billing_interval: body.billing_type === "recurring" ? body.billing_interval : null,
      is_taxable: body.is_taxable ?? false,
      is_active: true,
      stripe_product_id: stripeProductId,
    })
    .select()
    .single();

  if (error) {
    console.error("service-templates POST:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
