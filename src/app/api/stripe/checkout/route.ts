import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getStripe, TIER_NAMES } from "@/lib/stripe";

const DASHBOARD_URL = "https://dashboard.rosably.com";

export async function POST(req: NextRequest) {
  const { clientId } = await req.json();
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const { data: client, error } = await supabaseAdmin
    .schema("crm")
    .from("clients")
    .select("*, business:businesses(name), contact:contacts(email, first_name, last_name)")
    .eq("id", clientId)
    .single();

  if (error || !client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  if (!client.monthly_value) return NextResponse.json({ error: "Client has no monthly_value set" }, { status: 422 });

  const stripe = getStripe();

  // Create or reuse Stripe customer
  let customerId: string = client.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: client.contact?.email ?? undefined,
      name: client.business?.name ?? undefined,
      metadata: { client_id: client.id },
    });
    customerId = customer.id;
    await supabaseAdmin
      .schema("crm")
      .from("clients")
      .update({ stripe_customer_id: customerId })
      .eq("id", client.id);
  }

  const tierLabel = TIER_NAMES[client.service_tier ?? ""] ?? "Rosably Retainer";
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{
      price_data: {
        currency: "usd",
        recurring: { interval: "month" },
        product_data: { name: tierLabel },
        unit_amount: Math.round(client.monthly_value * 100),
      },
      quantity: 1,
    }],
    metadata: { client_id: client.id, business_name: client.business?.name ?? "" },
    success_url: `${DASHBOARD_URL}/crm/clients?stripe=success`,
    cancel_url:  `${DASHBOARD_URL}/crm/clients?stripe=cancelled`,
    subscription_data: {
      metadata: { client_id: client.id },
    },
  });

  return NextResponse.json({ url: session.url, customerId });
}
