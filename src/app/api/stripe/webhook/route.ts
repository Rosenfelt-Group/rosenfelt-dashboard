import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

function stripeStatusToBillingStatus(status: string): string {
  if (status === "active" || status === "trialing") return "active";
  if (status === "canceled")                          return "cancelled";
  return "paused"; // past_due, unpaid, incomplete, etc.
}

async function updateClientSubscription(
  clientId: string,
  subscriptionId: string,
  stripeStatus: string,
) {
  await supabaseAdmin
    .schema("crm")
    .from("clients")
    .update({
      stripe_subscription_id:     subscriptionId,
      stripe_subscription_status: stripeStatus,
      billing_status:             stripeStatusToBillingStatus(stripeStatus),
      updated_at:                 new Date().toISOString(),
    })
    .eq("id", clientId);
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

  if (event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated") {
    const sub = event.data.object as Stripe.Subscription;
    const clientId = sub.metadata?.client_id;
    if (clientId) await updateClientSubscription(clientId, sub.id, sub.status);
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    const clientId = sub.metadata?.client_id;
    if (clientId) await updateClientSubscription(clientId, sub.id, "canceled");
  }

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const subRef = invoice.parent?.subscription_details?.subscription;
    const subId  = typeof subRef === "string" ? subRef : subRef?.id;
    if (subId) {
      const sub = await stripe.subscriptions.retrieve(subId);
      const clientId = sub.metadata?.client_id;
      if (clientId) await updateClientSubscription(clientId, sub.id, sub.status);
    }
  }

  return NextResponse.json({ received: true });
}
