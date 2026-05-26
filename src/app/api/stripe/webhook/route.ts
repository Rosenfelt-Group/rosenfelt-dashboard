import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Maps a raw Stripe subscription.status into our local client_services.status enum.
function stripeStatusToServiceStatus(status: string): "active" | "paused" | "cancelled" {
  if (status === "active" || status === "trialing") return "active";
  if (status === "canceled") return "cancelled";
  return "paused"; // past_due, unpaid, incomplete, incomplete_expired
}

// Best-effort POST to Jordan's webhook to ping Brian on Telegram.
// Failures here are logged but never break the webhook response — Stripe needs
// 2xx within ~30s or it retries the event.
async function notifyBrianViaJordan(message: string) {
  const url = process.env.JORDAN_API_URL;
  const secret = process.env.JORDAN_WEBHOOK_SECRET ?? process.env.WEBHOOK_SECRET;
  const chatId = process.env.BRIAN_CHAT_ID;
  if (!url || !secret || !chatId) {
    console.warn("notifyBrianViaJordan: missing JORDAN_API_URL/SECRET/BRIAN_CHAT_ID");
    return;
  }
  try {
    await fetch(`${url}/webhook/jordan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
      body: JSON.stringify({ text: message, chatId, from_agent: "dashboard" }),
    });
  } catch (e) {
    console.error("notifyBrianViaJordan failed:", e);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig  = req.headers.get("stripe-signature");

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature or secret" }, { status: 400 });
  }

  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    if (event.type === "customer.subscription.created") {
      const sub = event.data.object as Stripe.Subscription;
      await supabaseAdmin
        .schema("crm")
        .from("client_services")
        .update({ stripe_subscription_status: "active" })
        .eq("stripe_subscription_id", sub.id);
    }

    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object as Stripe.Subscription;
      await supabaseAdmin
        .schema("crm")
        .from("client_services")
        .update({
          stripe_subscription_status: sub.status,
          status: stripeStatusToServiceStatus(sub.status),
        })
        .eq("stripe_subscription_id", sub.id);
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      await supabaseAdmin
        .schema("crm")
        .from("client_services")
        .update({
          status: "cancelled",
          stripe_subscription_status: "canceled",
        })
        .eq("stripe_subscription_id", sub.id);
    }

    if (event.type === "checkout.session.completed") {
      // Fires after a one_time service's Stripe Checkout completes successfully.
      // (Subscription-mode checkout would route through customer.subscription.created
      // instead — Stripe handles that one separately.) The session metadata carries
      // client_service_id (set at /activate time) so we can flip the row to active.
      const session = event.data.object as Stripe.Checkout.Session;
      const isTestMode = session.metadata?.test_mode === "true";
      const csId = session.metadata?.client_service_id;
      // Only act on paid one-time checkouts. Subscription-mode sessions land here
      // too on completion but the customer.subscription.created event already
      // handled the writeback for those.
      if (
        !isTestMode
        && csId
        && session.payment_status === "paid"
        && session.mode === "payment"
      ) {
        const priceRef = session.line_items?.data[0]?.price?.id;
        await supabaseAdmin
          .schema("crm")
          .from("client_services")
          .update({
            status: "active",
            billing_activated_at: new Date().toISOString(),
            billing_activated_by: "stripe_checkout",
            ...(priceRef ? { stripe_price_id: priceRef } : {}),
          })
          .eq("id", csId);
      }
    }

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const customerRef = invoice.customer;
      const customerId = typeof customerRef === "string" ? customerRef : customerRef?.id;
      let clientName = "(unknown client)";
      let serviceName = "(unknown service)";

      if (customerId) {
        // Find the client + most recent active service for this customer
        const { data: client } = await supabaseAdmin
          .schema("crm")
          .from("clients")
          .select("id, business:businesses(name)")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();
        if (client) {
          const business = Array.isArray(client.business) ? client.business[0] : client.business;
          if (business?.name) clientName = business.name;

          // Find the linked service via the invoice's subscription, if any
          const subRef = invoice.parent?.subscription_details?.subscription;
          const subId = typeof subRef === "string" ? subRef : subRef?.id;
          if (subId) {
            const { data: svc } = await supabaseAdmin
              .schema("crm")
              .from("client_services")
              .select("service_template:service_templates(name)")
              .eq("stripe_subscription_id", subId)
              .maybeSingle();
            const tmpl = svc && (Array.isArray(svc.service_template) ? svc.service_template[0] : svc.service_template);
            if (tmpl?.name) serviceName = tmpl.name;
          }
        }
      }

      await notifyBrianViaJordan(
        `⚠️ Payment failed for ${clientName} — ${serviceName}. Stripe invoice: ${invoice.id}`,
      );
    }
  } catch (e) {
    console.error("Stripe webhook handler error:", e);
    // Still return 200 so Stripe doesn't retry; the error is in our logs.
  }

  return NextResponse.json({ received: true });
}
