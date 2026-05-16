import { NextRequest, NextResponse } from "next/server";
import { getStripe, StripeMode } from "@/lib/stripe";

export async function GET(req: NextRequest) {
  const mode = (req.nextUrl.searchParams.get("mode") ?? "live") as StripeMode;
  const stripe = getStripe(mode);

  const [customers, subscriptions, invoices] = await Promise.all([
    stripe.customers.list({ limit: 100, expand: ["data.subscriptions"] }),
    stripe.subscriptions.list({ limit: 100, status: "all", expand: ["data.customer"] }),
    stripe.invoices.list({ limit: 30, expand: ["data.customer"] }),
  ]);

  const activeSubs  = subscriptions.data.filter(s => s.status === "active" || s.status === "trialing");
  const mrr = activeSubs.reduce((sum, s) => {
    const amount = s.items.data.reduce((a, i) => {
      const price = i.price;
      if (!price?.unit_amount) return a;
      const monthly = price.recurring?.interval === "year"
        ? price.unit_amount / 12
        : price.unit_amount;
      return a + monthly * (i.quantity ?? 1);
    }, 0);
    return sum + amount;
  }, 0);

  return NextResponse.json({
    mode,
    mrr,
    customers: customers.data,
    subscriptions: subscriptions.data,
    invoices: invoices.data,
    stats: {
      customerCount:    customers.data.length,
      activeSubCount:   activeSubs.length,
      failedInvoices:   invoices.data.filter(i => i.status === "uncollectible" || (i.attempt_count ?? 0) > 0 && i.status === "open").length,
    },
  });
}
