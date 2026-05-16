import { NextRequest, NextResponse } from "next/server";
import { getStripe, StripeMode } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  const { paymentIntentId, amount, reason, mode = "live" } = await req.json();
  if (!paymentIntentId) return NextResponse.json({ error: "paymentIntentId required" }, { status: 400 });

  const stripe = getStripe(mode as StripeMode);

  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      ...(amount ? { amount: Math.round(amount * 100) } : {}),
      ...(reason ? { reason } : {}),
    });
    return NextResponse.json({ refund });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create refund";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
