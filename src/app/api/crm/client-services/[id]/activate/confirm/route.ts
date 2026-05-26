import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getStripe } from "@/lib/stripe";

// POST /api/crm/client-services/[id]/activate/confirm?mode=live|test
// Body: { payment_method_id, setup_intent_id, stripe_price_id, stripe_customer_id? }
//
// Called by the client after Stripe Elements has captured a payment method.
// In live mode: confirm the PM, create the subscription, write back to crm.client_services.
// In test mode: same Stripe round-trip, but no DB writeback — the row stays in
// pending_activation. The caller must pass stripe_customer_id (returned from
// /activate) since we don't read it from crm.clients in test mode.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const isTest = searchParams.get("mode") === "test";

  let body: {
    payment_method_id?: string;
    setup_intent_id?: string;
    stripe_price_id?: string;
    stripe_customer_id?: string;
  };
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

  // In test mode, the test customer ID comes from the activate response (not from DB).
  // In live mode, it must already be on crm.clients (activate persisted it).
  const stripeCustomerId = isTest ? body.stripe_customer_id : client?.stripe_customer_id;
  if (!stripeCustomerId) {
    return NextResponse.json(
      {
        error: isTest
          ? "Test mode requires stripe_customer_id in request body (from activate response)"
          : "Client has no stripe_customer_id (run activate first)",
      },
      { status: 422 },
    );
  }

  const stripe = getStripe(isTest ? "test" : "live");

  // Attach the payment method to the customer (no-op if already attached).
  try {
    await stripe.paymentMethods.attach(body.payment_method_id, { customer: stripeCustomerId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "attach failed";
    if (!msg.toLowerCase().includes("already")) {
      console.error("Stripe payment method attach failed:", e);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // billing_cycle_anchor from billing_start_date (Unix seconds, UTC midnight).
  // In test mode we skip the start-date math since the CRM row's billing_start_date
  // wasn't written by /activate (it's deferred to live mode); subscription runs immediately.
  let anchor: number | undefined = undefined;
  if (!isTest && service.billing_start_date) {
    const t = Date.parse(`${service.billing_start_date}T00:00:00Z`);
    if (!Number.isNaN(t)) anchor = Math.floor(t / 1000);
  }

  let subscription;
  try {
    subscription = await stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [{ price: body.stripe_price_id }],
      default_payment_method: body.payment_method_id,
      proration_behavior: "none",
      ...(anchor && anchor > Math.floor(Date.now() / 1000)
        ? { billing_cycle_anchor: anchor, trial_end: anchor }
        : {}),
      metadata: {
        client_service_id: id,
        client_id: service.client_id,
        ...(isTest ? { test_mode: "true" } : {}),
      },
    });
  } catch (e) {
    console.error("Stripe subscription create failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Stripe error" }, { status: 500 });
  }

  // Live mode: write back the subscription IDs and flip status='active'.
  // Test mode: skip — the row stays pending_activation, ready for a real activation.
  if (!isTest) {
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
  }

  return NextResponse.json({
    success: true,
    subscription_id: subscription.id,
    subscription_status: subscription.status,
    test_mode: isTest,
  });
}
