import Stripe from "stripe";

export type StripeMode = "live" | "test";

// Per-mode lazy singletons — avoids throwing at module evaluation time during
// the Next.js build when Stripe keys are absent from the environment.
const _instances: Partial<Record<StripeMode, Stripe>> = {};

export function getStripe(mode: StripeMode = "live"): Stripe {
  if (!_instances[mode]) {
    const key = mode === "test"
      ? process.env.STRIPE_SECRET_KEY_TEST
      : process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error(`Stripe key not set for mode: ${mode} (expected ${mode === "test" ? "STRIPE_SECRET_KEY_TEST" : "STRIPE_SECRET_KEY"})`);
    _instances[mode] = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
  }
  return _instances[mode]!;
}

export const TIER_NAMES: Record<string, string> = {
  newsroom:    "Newsroom Retainer",
  operations:  "Operations Retainer",
  finance_ops: "Finance Ops Retainer",
  growth_stack:"Growth Stack Retainer",
  full_stack:  "Full Stack Retainer",
};
