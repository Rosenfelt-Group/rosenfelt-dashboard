"use client";
import { useMemo, useState } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import clsx from "clsx";
import type { ClientService } from "@/types";

type Props = {
  service: ClientService;
  onClose: () => void;
  onActivated: () => void;
};

// Returns null if the env var is missing — the modal renders a clear message
// instead of crashing.
function makeStripePromise(testMode: boolean): Promise<StripeJs | null> | null {
  const key = testMode
    ? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST
    : process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!key) return null;
  return loadStripe(key);
}

export function ActivationModal({ service, onClose, onActivated }: Props) {
  const billingType = service.service_template?.billing_type;
  const defaultRate = service.monthly_rate ?? service.project_rate ?? service.hourly_rate ?? "";

  const [testMode, setTestMode] = useState(false);
  // Stripe promise is keyed on testMode so flipping the checkbox swaps clients.
  const stripePromise = useMemo(() => makeStripePromise(testMode), [testMode]);
  const [billingStartDate, setBillingStartDate] = useState<string>(
    service.billing_start_date ?? new Date().toISOString().slice(0, 10),
  );
  const [confirmedRate, setConfirmedRate] = useState<string>(String(defaultRate ?? ""));
  const [step, setStep] = useState<"form" | "card" | "submitting" | "done">("form");
  const [activatePayload, setActivatePayload] = useState<{
    client_secret: string;
    setup_intent_id: string;
    stripe_price_id: string;
    stripe_customer_id: string;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const apiModeSuffix = testMode ? "?mode=test" : "";

  async function handleActivate() {
    const rate = Number(confirmedRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      setErr("Confirmed rate must be a positive number");
      return;
    }
    if (!billingStartDate) {
      setErr("Billing start date required");
      return;
    }
    setErr(null);
    setStep("submitting");
    try {
      const r = await fetch(`/api/crm/client-services/${service.id}/activate${apiModeSuffix}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billing_start_date: billingStartDate, confirmed_rate: rate }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);

      if (data.activated) {
        setStep("done");
        onActivated();
        return;
      }
      if (data.redirect_url) {
        // one_time → Checkout; open in new tab and let the success URL bring the user back
        window.open(data.redirect_url, "_blank", "noopener,noreferrer");
        setStep("done");
        onActivated();
        return;
      }
      if (data.requires_payment_method) {
        setActivatePayload({
          client_secret: data.client_secret,
          setup_intent_id: data.setup_intent_id,
          stripe_price_id: data.stripe_price_id,
          stripe_customer_id: data.stripe_customer_id,
        });
        setStep("card");
        return;
      }
      throw new Error("Unexpected response from activate endpoint");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Activation failed");
      setStep("form");
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
        <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between">
          <h3 className="font-semibold text-brand-black text-sm">
            Activate billing — {service.service_template?.name ?? "Service"}
          </h3>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-black text-lg leading-none">×</button>
        </div>
        <div className="p-4 space-y-3">
          {/* Test mode toggle: only meaningful before card capture starts.
              Once we hit step==='card' the Stripe Elements instance is already
              keyed to the chosen mode, so the checkbox locks. */}
          {(step === "form" || step === "submitting") && (
            <label className={clsx(
              "flex items-center gap-2 text-xs px-2 py-1.5 rounded border",
              testMode ? "border-amber-300 bg-amber-50 text-amber-900" : "border-brand-border text-brand-muted",
            )}>
              <input
                type="checkbox"
                checked={testMode}
                onChange={(e) => { setTestMode(e.target.checked); setErr(null); }}
              />
              <span>🧪 Test mode (uses Stripe test keys — no real charges, no DB writeback)</span>
            </label>
          )}
          {step === "card" && testMode && (
            <div className="text-xs px-2 py-1.5 rounded border border-amber-300 bg-amber-50 text-amber-900">
              🧪 Test mode — use card <code className="font-mono">4242 4242 4242 4242</code>, any future exp, any CVC.
            </div>
          )}
          {step === "form" || step === "submitting" ? (
            <>
              <div>
                <div className="text-[10px] uppercase text-brand-muted mb-1">Billing start date</div>
                <input
                  type="date"
                  value={billingStartDate}
                  onChange={(e) => setBillingStartDate(e.target.value)}
                  className="w-full rounded border border-brand-border px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <div className="text-[10px] uppercase text-brand-muted mb-1">
                  Confirmed rate (USD) {billingType === "tm" && "— hourly"}
                </div>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={confirmedRate}
                  onChange={(e) => setConfirmedRate(e.target.value)}
                  className="w-full rounded border border-brand-border px-2 py-1.5 text-sm"
                />
              </div>
              {billingType === "recurring" && (
                <p className="text-[11px] text-brand-muted">
                  Next step collects a payment method via Stripe Elements (the dashboard never sees the card number).
                </p>
              )}
              {billingType === "tm" && (
                <p className="text-[11px] text-brand-muted">
                  T&M services skip Stripe activation — hours are billed monthly via the Invoice flow.
                </p>
              )}
              {billingType === "one_time" && (
                <p className="text-[11px] text-brand-muted">
                  Opens a Stripe Checkout session in a new tab. After payment the service flips to active via the Stripe webhook.
                </p>
              )}
              {err && <div className="text-xs text-red-700">{err}</div>}
            </>
          ) : step === "card" && activatePayload ? (
            stripePromise ? (
              <Elements stripe={stripePromise} options={{ clientSecret: activatePayload.client_secret }}>
                <CardForm
                  service={service}
                  activatePayload={activatePayload}
                  testMode={testMode}
                  onSuccess={() => { setStep("done"); onActivated(); }}
                  onErr={(m) => { setErr(m); }}
                />
              </Elements>
            ) : (
              <div className="text-xs text-red-700">
                {testMode
                  ? "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST is not set in this environment. Set it in Vercel before running the test-mode flow."
                  : "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set in this environment. Set it in Vercel before activating recurring services."}
              </div>
            )
          ) : testMode ? (
            <div className="space-y-2">
              <div className="text-sm text-brand-black">✅ Test mode succeeded.</div>
              <p className="text-xs text-brand-muted leading-relaxed">
                Stripe accepted the card and created the subscription in <strong>test mode</strong>.
                Check the Stripe Dashboard (Test mode) → Subscriptions to see it.
                The CRM row stays in <code className="text-[11px] bg-brand-cream px-1 rounded">pending_activation</code> —
                untick Test mode and re-run to activate for real.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-sm text-brand-black">✅ Service activated.</div>
              <p className="text-xs text-brand-muted">
                Subscription created. Row flipped to <code className="text-[11px] bg-brand-cream px-1 rounded">active</code>.
              </p>
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-brand-border flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1 hover:bg-brand-cream rounded">
            {step === "done" ? "Close" : "Cancel"}
          </button>
          {step === "form" && (
            <button onClick={handleActivate} className="btn-primary text-xs px-3 py-1.5">
              {billingType === "recurring" ? "Continue to card" : billingType === "one_time" ? "Open Stripe Checkout" : "Activate"}
            </button>
          )}
          {step === "submitting" && (
            <button disabled className="btn-primary text-xs px-3 py-1.5 opacity-60">Working…</button>
          )}
        </div>
      </div>
    </div>
  );
}

// Card form (sub-component so it can use useStripe/useElements from <Elements>)
function CardForm({
  service,
  activatePayload,
  testMode,
  onSuccess,
  onErr,
}: {
  service: ClientService;
  activatePayload: { client_secret: string; setup_intent_id: string; stripe_price_id: string; stripe_customer_id: string };
  testMode: boolean;
  onSuccess: () => void;
  onErr: (m: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  async function submit() {
    if (!stripe || !elements) return;
    const card = elements.getElement(CardElement);
    if (!card) return;
    setSubmitting(true);
    setLocalErr(null);
    try {
      const result = await stripe.confirmCardSetup(activatePayload.client_secret, {
        payment_method: { card },
      });
      if (result.error) {
        setLocalErr(result.error.message ?? "Card setup failed");
        onErr(result.error.message ?? "Card setup failed");
        setSubmitting(false);
        return;
      }
      const setupIntent = result.setupIntent;
      if (!setupIntent?.payment_method) {
        setLocalErr("No payment method returned from Stripe");
        setSubmitting(false);
        return;
      }
      const pmId = typeof setupIntent.payment_method === "string"
        ? setupIntent.payment_method
        : setupIntent.payment_method.id;

      const r = await fetch(
        `/api/crm/client-services/${service.id}/activate/confirm${testMode ? "?mode=test" : ""}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payment_method_id: pmId,
            setup_intent_id: activatePayload.setup_intent_id,
            stripe_price_id: activatePayload.stripe_price_id,
            // In test mode the server doesn't read stripe_customer_id from DB,
            // so we have to pass back the test customer ID we got from /activate.
            ...(testMode ? { stripe_customer_id: activatePayload.stripe_customer_id } : {}),
          }),
        },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      onSuccess();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Activation confirm failed";
      setLocalErr(msg);
      onErr(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded border border-brand-border px-3 py-2.5 bg-white">
        <CardElement options={{
          hidePostalCode: false,
          style: { base: { fontSize: "14px" } },
        }} />
      </div>
      {localErr && <div className="text-xs text-red-700">{localErr}</div>}
      <button
        onClick={submit}
        disabled={!stripe || submitting}
        className="btn-primary text-xs px-3 py-1.5 w-full disabled:opacity-60"
      >
        {submitting ? "Confirming…" : "Save card & activate"}
      </button>
    </div>
  );
}
