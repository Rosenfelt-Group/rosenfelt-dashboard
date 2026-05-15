import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-04-22.dahlia",
});

export const TIER_NAMES: Record<string, string> = {
  newsroom:    "Newsroom Retainer",
  operations:  "Operations Retainer",
  finance_ops: "Finance Ops Retainer",
  growth_stack:"Growth Stack Retainer",
  full_stack:  "Full Stack Retainer",
};
