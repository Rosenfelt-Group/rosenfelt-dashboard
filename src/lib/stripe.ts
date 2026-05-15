import Stripe from "stripe";

// Lazy singleton — avoids throwing at module evaluation during Next.js build
// when STRIPE_SECRET_KEY is not yet present in the environment.
let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not set");
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2026-04-22.dahlia",
    });
  }
  return _stripe;
}

export const TIER_NAMES: Record<string, string> = {
  newsroom:    "Newsroom Retainer",
  operations:  "Operations Retainer",
  finance_ops: "Finance Ops Retainer",
  growth_stack:"Growth Stack Retainer",
  full_stack:  "Full Stack Retainer",
};
