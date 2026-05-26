import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getStripe } from "@/lib/stripe";

// POST /api/crm/client-services/[id]/activate?mode=live|test
// Body: { billing_start_date: 'YYYY-MM-DD', confirmed_rate: number (dollars) }
//
// Per service billing_type:
//   recurring → create Stripe price + SetupIntent; return { requires_payment_method,
//               client_secret, setup_intent_id, stripe_price_id, ... } so the
//               client renders Stripe Elements and finalizes via /activate/confirm.
//   one_time  → create a Checkout session; return { redirect_url }.
//   tm        → no Stripe action; row goes straight to active.
//
// mode=test: uses STRIPE_SECRET_KEY_TEST + skips all crm.* writebacks so the live
// data stays clean. Test customers, prices, SetupIntents land in Stripe test mode;
// the CRM row stays in 'pending_activation'.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const isTest = searchParams.get("mode") === "test";

  let body: { billing_start_date?: string; confirmed_rate?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.billing_start_date || typeof body.confirmed_rate !== "number") {
    return NextResponse.json(
      { error: "billing_start_date and confirmed_rate are required" },
      { status: 400 },
    );
  }

  // Fetch the row + joined template + joined client
  const { data: service, error: fetchErr } = await supabaseAdmin
    .schema("crm")
    .from("client_services")
    .select(`
      id, client_id, status,
      service_template:service_templates(*),
      client:clients(id, stripe_customer_id, business:businesses(name), contact:contacts(first_name, last_name, email))
    `)
    .eq("id", id)
    .single();
  if (fetchErr) {
    if (fetchErr.code === "PGRST116") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (service.status !== "pending_activation") {
    return NextResponse.json(
      { error: `Cannot activate: service is in status '${service.status}'` },
      { status: 409 },
    );
  }

  // PostgREST's typed query returns joined relations as arrays in the inferred
  // type even when only one row exists. Coerce to single object for ergonomics.
  const tmpl = Array.isArray(service.service_template) ? service.service_template[0] : service.service_template;
  const client = Array.isArray(service.client) ? service.client[0] : service.client;

  if (!tmpl) {
    return NextResponse.json({ error: "Service template missing" }, { status: 500 });
  }
  // Live mode requires a persisted Stripe product. Test mode creates an inline
  // product per activation (Stripe test mode is a separate object space from
  // live, so the live stripe_product_id wouldn't resolve there anyway).
  if (!isTest && !tmpl.stripe_product_id) {
    return NextResponse.json(
      { error: "Service template has no stripe_product_id — admin must set one first" },
      { status: 422 },
    );
  }

  const stripe = getStripe(isTest ? "test" : "live");

  // In test mode: build the price's product inline via Stripe's product_data so
  // we don't depend on any test-mode product catalog. In live mode: reference
  // the persisted product by ID.
  // `priceProductRef` is spread into both prices.create() calls below.
  const priceProductRef = isTest
    ? { product_data: { name: `[TEST] ${tmpl.name}` } }
    : { product: tmpl.stripe_product_id as string };

  // Ensure the client has a Stripe customer. In test mode, always create a
  // fresh test customer — don't read or write client.stripe_customer_id, since
  // test/live customer IDs are mutually exclusive in Stripe and overwriting a
  // live ID with a test one would brick subsequent live operations.
  let stripeCustomerId = isTest ? undefined : client?.stripe_customer_id;
  if (!stripeCustomerId) {
    const business = Array.isArray(client?.business) ? client.business[0] : client?.business;
    const contact = Array.isArray(client?.contact) ? client.contact[0] : client?.contact;
    const customerName = business?.name
      ?? [contact?.first_name, contact?.last_name].filter(Boolean).join(" ")
      ?? "Rosably client";
    const customerEmail = contact?.email ?? undefined;
    try {
      const customer = await stripe.customers.create({
        name: isTest ? `[TEST] ${customerName}` : customerName,
        email: customerEmail,
        metadata: {
          client_id: service.client_id,
          ...(isTest ? { test_mode: "true" } : {}),
        },
      });
      stripeCustomerId = customer.id;
      if (!isTest) {
        await supabaseAdmin
          .schema("crm")
          .from("clients")
          .update({ stripe_customer_id: stripeCustomerId })
          .eq("id", service.client_id);
      }
    } catch (e) {
      console.error("Stripe customer create failed:", e);
      return NextResponse.json({ error: "Stripe customer create failed" }, { status: 500 });
    }
  }

  const billingType = tmpl.billing_type as "recurring" | "one_time" | "tm";
  const amountCents = Math.round(body.confirmed_rate * 100);

  // ─── recurring ───────────────────────────────────────────────────────────
  if (billingType === "recurring") {
    const interval = (tmpl.billing_interval ?? "month") as "month" | "quarter" | "year";
    const stripeInterval = interval === "quarter" ? "month" : interval;
    const intervalCount = interval === "quarter" ? 3 : 1;
    try {
      const price = await stripe.prices.create({
        ...priceProductRef,
        unit_amount: amountCents,
        currency: "usd",
        recurring: { interval: stripeInterval, interval_count: intervalCount },
      });
      const setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomerId,
        payment_method_types: ["card"],
        usage: "off_session",
        metadata: {
          client_service_id: id,
          stripe_price_id: price.id,
          ...(isTest ? { test_mode: "true" } : {}),
        },
      });
      // Persist start date + rate now; the subscription comes through in /confirm.
      // In test mode, skip writebacks — the row stays in pending_activation.
      if (!isTest) {
        await supabaseAdmin
          .schema("crm")
          .from("client_services")
          .update({
            monthly_rate: body.confirmed_rate,
            billing_start_date: body.billing_start_date,
          })
          .eq("id", id);
      }
      return NextResponse.json({
        requires_payment_method: true,
        client_secret: setupIntent.client_secret,
        setup_intent_id: setupIntent.id,
        stripe_price_id: price.id,
        stripe_customer_id: stripeCustomerId,
        client_service_id: id,
        amount: body.confirmed_rate,
        test_mode: isTest,
      });
    } catch (e) {
      console.error("Stripe recurring activation failed:", e);
      return NextResponse.json({ error: e instanceof Error ? e.message : "Stripe error" }, { status: 500 });
    }
  }

  // ─── one_time ────────────────────────────────────────────────────────────
  if (billingType === "one_time") {
    try {
      const price = await stripe.prices.create({
        ...priceProductRef,
        unit_amount: amountCents,
        currency: "usd",
      });
      const baseUrl = process.env.DASHBOARD_BASE_URL ?? "https://dashboard.rosably.com";
      const checkout = await stripe.checkout.sessions.create({
        mode: "payment",
        customer: stripeCustomerId,
        line_items: [{ price: price.id, quantity: 1 }],
        success_url: `${baseUrl}/crm/clients/${service.client_id}?activated=${id}`,
        cancel_url: `${baseUrl}/crm/clients/${service.client_id}?cancelled=${id}`,
        metadata: {
          client_service_id: id,
          ...(isTest ? { test_mode: "true" } : {}),
        },
      });
      return NextResponse.json({
        redirect_url: checkout.url,
        stripe_price_id: price.id,
        checkout_session_id: checkout.id,
        test_mode: isTest,
      });
    } catch (e) {
      console.error("Stripe one_time activation failed:", e);
      return NextResponse.json({ error: e instanceof Error ? e.message : "Stripe error" }, { status: 500 });
    }
  }

  // ─── tm ──────────────────────────────────────────────────────────────────
  if (billingType === "tm") {
    if (isTest) {
      // T&M doesn't make a Stripe call at activate time — in test mode there's
      // literally nothing to verify, so just acknowledge without touching the row.
      return NextResponse.json({ activated: true, test_mode: true, note: "test mode: no DB writeback" });
    }
    const { error: actErr } = await supabaseAdmin
      .schema("crm")
      .from("client_services")
      .update({
        hourly_rate: body.confirmed_rate,
        billing_start_date: body.billing_start_date,
        status: "active",
        billing_activated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (actErr) {
      console.error("T&M activation failed:", actErr);
      return NextResponse.json({ error: actErr.message }, { status: 500 });
    }
    return NextResponse.json({ activated: true });
  }

  return NextResponse.json({ error: `Unknown billing_type: ${billingType}` }, { status: 500 });
}
