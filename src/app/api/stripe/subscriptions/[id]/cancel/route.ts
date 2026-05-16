import { NextRequest, NextResponse } from "next/server";
import { getStripe, StripeMode } from "@/lib/stripe";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { mode = "live" } = await req.json().catch(() => ({}));
  const stripe = getStripe(mode as StripeMode);

  try {
    const subscription = await stripe.subscriptions.cancel(id);
    return NextResponse.json({ subscription });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to cancel subscription";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
