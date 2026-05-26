import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getStripe } from "@/lib/stripe";

// POST /api/crm/client-services/[id]/activate/confirm
// Called by the client after Stripe Elements has captured a payment method.
// Body: { payment_method_id, setup_intent_id, stripe_price_id }
// Server: confirm the payment method is attached, create the subscription,
//   write back to crm.client_services.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { payment_method_id?: string; setup_intent_id?: string; stripe_price_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.payment_method_id || !body.stripe_price_id) {
    return NextResponse.json(
      { error: "payment_method_id and stripe_price_id are required" },
      { status: 400 },
    );
  }

  // Lookup client_service + its client_id + start date
  const { data: service, error: fetchErr } = await supabaseAdmin
    .schema("crm")
    .from("client_services")
    .select("id, client_id, billing_start_date, client:clients(stripe_customer_id)")
    .eq("id", id)
    .single();
  if (fetchErr) {
    if (fetchErr.code === "PGRST116") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  const client = Array.isArray(service.client) ? service.client[0] : service.client;
  if (!client?.stripe_customer_id) {
    return NextResponse.json({ error: "Client has no stripe_customer_id (run activate first)" }, { status: 422 });
  }

  const stripe = getStripe();

  // Attach the payment method to the customer (no-op if already attached).
  try {
    await stripe.paymentMethods.attach(body.payment_method_id, { customer: client.stripe_customer_id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "attach failed";
    if (!msg.toLowerCase().includes("already")) {
      console.error("Stripe payment method attach failed:", e);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // billing_cycle_anchor from billing_start_date (Unix seconds, UTC midnight)
  let anchor: number | undefined = undefined;
  if (service.billing_start_date) {
    const t = Date.parse(`${service.billing_start_date}T00:00:00Z`);
    if (!Number.isNaN(t)) anchor = Math.floor(t / 1000);
  }

  let subscription;
  try {
    subscription = await stripe.subscriptions.create({
      customer: client.stripe_customer_id,
      items: [{ price: body.stripe_price_id }],
      default_payment_method: body.payment_method_id,
      proration_behavior: "none",
      ...(anchor && anchor > Math.floor(Date.now() / 1000)
        ? { billing_cycle_anchor: anchor, trial_end: anchor }
        : {}),
      metadata: { client_service_id: id, client_id: service.client_id },
    });
  } catch (e) {
    console.error("Stripe subscription create failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Stripe error" }, { status: 500 });
  }

  const { error: updErr } = await supabaseAdmin
    .schema("crm")
    .from("client_services")
    .update({
      stripe_subscription_id: subscription.id,
      stripe_subscription_status: subscription.status,
      stripe_price_id: body.stripe_price_id,
      status: "active",
      billing_activated_at: new Date().toISOString(),
      billing_activated_by: "brian",
    })
    .eq("id", id);
  if (updErr) {
    console.error("client_services writeback failed:", updErr);
    return NextResponse.json({
      error: "Subscription created but writeback failed",
      stripe_subscription_id: subscription.id,
    }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    subscription_id: subscription.id,
    subscription_status: subscription.status,
  });
}
