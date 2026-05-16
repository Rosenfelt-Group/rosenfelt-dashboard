"use client";
import { useEffect, useState, useCallback } from "react";
import clsx from "clsx";
import type Stripe from "stripe";

type StripeMode = "live" | "test";
type Tab = "subscriptions" | "invoices" | "customers" | "refunds";

interface DashboardData {
  mode: StripeMode;
  mrr: number;
  customers: Stripe.Customer[];
  subscriptions: Stripe.Subscription[];
  invoices: Stripe.Invoice[];
  refunds: Stripe.Refund[];
  stats: { customerCount: number; activeSubCount: number; failedInvoices: number; refundCount: number };
}

const SUB_STATUS_STYLES: Record<string, string> = {
  active:             "badge-success",
  trialing:           "badge-warning",
  past_due:           "badge-error",
  canceled:           "badge-neutral",
  incomplete:         "badge-warning",
  incomplete_expired: "badge-neutral",
  unpaid:             "badge-error",
  paused:             "badge-neutral",
};

const INV_STATUS_STYLES: Record<string, string> = {
  paid:          "badge-success",
  open:          "badge-warning",
  void:          "badge-neutral",
  uncollectible: "badge-error",
  draft:         "badge-neutral",
};

const REFUND_STATUS_STYLES: Record<string, string> = {
  succeeded:       "badge-success",
  pending:         "badge-warning",
  requires_action: "badge-warning",
  failed:          "badge-error",
  canceled:        "badge-neutral",
};

const REFUND_REASON_LABELS: Record<string, string> = {
  requested_by_customer: "Requested by customer",
  duplicate:             "Duplicate",
  fraudulent:            "Fraudulent",
};

function fmt(cents: number) {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function customerName(c: Stripe.Customer | Stripe.DeletedCustomer | string | null): string {
  if (!c || typeof c === "string") return c ?? "—";
  if ("deleted" in c) return c.id;
  return c.name || c.email || c.id;
}

// payment_intent and current_period_end were removed from top-level types in 2026-04-22.dahlia
// but still exist at runtime; access via explicit cast.
function invoicePaymentIntentId(inv: Stripe.Invoice): string | null {
  const pi = inv.payments?.data?.[0]?.payment.payment_intent;
  if (pi) return typeof pi === "string" ? pi : pi.id;
  return (inv as unknown as Record<string, string>).payment_intent ?? null;
}
function subPeriodEnd(sub: Stripe.Subscription): number | null {
  return (sub as unknown as Record<string, number>).current_period_end ?? null;
}

interface RefundModalProps {
  invoice: Stripe.Invoice;
  mode: StripeMode;
  onClose: () => void;
  onDone: () => void;
}
function RefundModal({ invoice, mode, onClose, onDone }: RefundModalProps) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("requested_by_customer");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [succeeded, setSucceeded] = useState<string | null>(null);

  const total = invoice.amount_paid / 100;

  async function submit() {
    const amtNum = amount ? parseFloat(amount) : null;
    if (amtNum !== null && (amtNum <= 0 || amtNum > total)) {
      setError(`Amount must be between $0.01 and $${total.toFixed(2)}`);
      return;
    }
    setLoading(true);
    setError("");
    const r = await fetch("/api/stripe/refunds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentIntentId: invoicePaymentIntentId(invoice),
        amount: amtNum,
        reason,
        mode,
      }),
    });
    const data = await r.json();
    setLoading(false);
    if (!r.ok) { setError(data.error ?? "Refund failed"); return; }
    const refundedAmt = data.refund?.amount ? fmt(data.refund.amount) : (amtNum ? `$${amtNum.toFixed(2)}` : fmt(invoice.amount_paid));
    setSucceeded(refundedAmt);
    setTimeout(onDone, 2000);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-sm p-6 shadow-xl">
        {succeeded ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-3">✓</div>
            <p className="text-sm font-semibold text-brand-black">Refund issued</p>
            <p className="text-xs text-brand-muted mt-1">{succeeded} will be returned to the customer.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-brand-black">Refund invoice</h2>
              <button onClick={onClose} className="text-brand-muted hover:text-brand-black text-lg">✕</button>
            </div>
            <p className="text-sm text-brand-muted mb-4">
              Invoice total: <span className="font-medium text-brand-black">{fmt(invoice.amount_paid)}</span>
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Amount (leave blank for full refund)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={total}
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  placeholder={`${total.toFixed(2)}`}
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-brand-muted mb-1 block">Reason</label>
                <select
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-orange"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                >
                  <option value="requested_by_customer">Requested by customer</option>
                  <option value="duplicate">Duplicate</option>
                  <option value="fraudulent">Fraudulent</option>
                </select>
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
              <button
                onClick={submit}
                disabled={loading || !invoicePaymentIntentId(invoice)}
                className="btn-primary flex-1 disabled:opacity-50"
              >
                {loading ? "Refunding…" : "Refund"}
              </button>
            </div>
            {!invoicePaymentIntentId(invoice) && (
              <p className="text-xs text-brand-muted mt-2 text-center">No payment intent attached to this invoice.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function BillingPage() {
  const [mode, setMode] = useState<StripeMode>("test");
  const [tab, setTab] = useState<Tab>("subscriptions");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [refundInvoice, setRefundInvoice] = useState<Stripe.Invoice | null>(null);

  const load = useCallback(async (m: StripeMode) => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`/api/stripe/dashboard?mode=${m}`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? `Failed to load Stripe data (${r.status})`);
        setData(null);
      } else {
        setData(await r.json());
      }
    } catch {
      setError("Network error loading Stripe data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(mode); }, [mode, load]);

  async function cancelSubscription(id: string) {
    if (!confirm("Cancel this subscription? This cannot be undone.")) return;
    setCancellingId(id);
    const r = await fetch(`/api/stripe/subscriptions/${id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    setCancellingId(null);
    if (r.ok) load(mode);
    else {
      const d = await r.json().catch(() => ({}));
      alert(d.error ?? "Failed to cancel subscription");
    }
  }

  const activeSubs = data?.subscriptions.filter(s => s.status === "active" || s.status === "trialing") ?? [];
  const stripeBase = mode === "test"
    ? "https://dashboard.stripe.com/test"
    : "https://dashboard.stripe.com";

  return (
    <div className="p-4 md:p-8 max-w-5xl pb-24 md:pb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-brand-black">Stripe Billing</h1>
          <p className="text-sm text-brand-muted mt-0.5">Subscriptions, invoices, and customers</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`${stripeBase}/dashboard`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-brand-muted underline underline-offset-2 hover:text-brand-black"
          >
            Open Stripe ↗
          </a>
          <div className="flex items-center rounded-lg border border-brand-border overflow-hidden text-xs font-medium">
            <button
              onClick={() => { setMode("live"); }}
              className={clsx("px-3 py-1.5 transition-colors", mode === "live" ? "bg-brand-black text-white" : "text-brand-muted hover:bg-brand-offwhite")}
            >
              Live
            </button>
            <button
              onClick={() => { setMode("test"); }}
              className={clsx("px-3 py-1.5 transition-colors", mode === "test" ? "bg-brand-orange text-white" : "text-brand-muted hover:bg-brand-offwhite")}
            >
              Test
            </button>
          </div>
        </div>
      </div>

      {/* Test mode banner */}
      {mode === "test" && (
        <div className="mb-5 px-4 py-2.5 rounded-lg bg-orange-50 border border-orange-200 text-xs text-orange-700 font-medium flex items-center gap-2">
          <span>⚡</span>
          <span>Test mode — using <code>STRIPE_SECRET_KEY_TEST</code>. No real money moves. Use Stripe test cards (e.g. 4242 4242 4242 4242).</span>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="card mb-5 border-red-200 bg-red-50">
          <p className="text-sm text-red-600">{error}</p>
          {error.includes("not set") && (
            <p className="text-xs text-red-500 mt-1">
              Add <code>{mode === "test" ? "STRIPE_SECRET_KEY_TEST" : "STRIPE_SECRET_KEY"}</code> to Vercel env vars, then redeploy.
            </p>
          )}
        </div>
      )}

      {/* Summary stats */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "MRR",               value: fmt(data.mrr) },
            { label: "Active subs",        value: String(data.stats.activeSubCount) },
            { label: "Customers",          value: String(data.stats.customerCount) },
            { label: "Refunds",            value: String(data.stats.refundCount) },
          ].map(s => (
            <div key={s.label} className="card">
              <p className="text-xs text-brand-muted">{s.label}</p>
              <p className="text-xl font-semibold text-brand-black mt-1">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-brand-border">
        {(["subscriptions", "invoices", "customers", "refunds"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              "px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px",
              tab === t
                ? "border-brand-orange text-brand-orange"
                : "border-transparent text-brand-muted hover:text-brand-black"
            )}
          >
            {t}
            {t === "subscriptions" && data && <span className="ml-1.5 text-xs opacity-60">({activeSubs.length})</span>}
            {t === "invoices" && data && <span className="ml-1.5 text-xs opacity-60">({data.invoices.length})</span>}
            {t === "customers" && data && <span className="ml-1.5 text-xs opacity-60">({data.stats.customerCount})</span>}
            {t === "refunds" && data && <span className="ml-1.5 text-xs opacity-60">({data.stats.refundCount})</span>}
          </button>
        ))}
      </div>

      {loading && <div className="card animate-pulse h-40" />}

      {/* Subscriptions */}
      {!loading && tab === "subscriptions" && data && (
        <div className="space-y-3">
          {data.subscriptions.length === 0 ? (
            <div className="card text-center py-10 text-sm text-brand-muted">No subscriptions yet.</div>
          ) : data.subscriptions.map(sub => {
            const item = sub.items.data[0];
            const price = item?.price;
            const amount = price?.unit_amount ?? 0;
            const interval = price?.recurring?.interval ?? "mo";
            const cust = sub.customer;
            return (
              <div key={sub.id} className="card">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-medium text-brand-black">{customerName(cust)}</p>
                    <p className="text-xs text-brand-muted mt-0.5">
                      {price?.nickname ?? "Subscription"} · {fmt(amount)}/{interval}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={clsx("badge text-xs", SUB_STATUS_STYLES[sub.status] ?? "badge-neutral")}>
                      {sub.status.replace("_", " ")}
                    </span>
                    <a
                      href={`${stripeBase}/subscriptions/${sub.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-brand-muted underline underline-offset-2 hover:text-brand-black"
                    >
                      Stripe ↗
                    </a>
                    {sub.status !== "canceled" && (
                      <button
                        onClick={() => cancelSubscription(sub.id)}
                        disabled={cancellingId === sub.id}
                        className="text-xs text-red-500 underline underline-offset-2 hover:opacity-70 disabled:opacity-40"
                      >
                        {cancellingId === sub.id ? "Cancelling…" : "Cancel"}
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-brand-border text-xs text-brand-muted flex-wrap">
                  <span>Started {fmtDate(sub.start_date)}</span>
                  {subPeriodEnd(sub) && (
                    <span>Next billing {fmtDate(subPeriodEnd(sub)!)}</span>
                  )}
                  <span className="ml-auto font-mono text-brand-muted opacity-60">{sub.id}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Invoices */}
      {!loading && tab === "invoices" && data && (
        <div className="space-y-3">
          {data.invoices.length === 0 ? (
            <div className="card text-center py-10 text-sm text-brand-muted">No invoices yet.</div>
          ) : data.invoices.map(inv => {
            const canRefund = inv.status === "paid" && !!invoicePaymentIntentId(inv);
            return (
              <div key={inv.id} className="card">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-medium text-brand-black">{customerName(inv.customer)}</p>
                    <p className="text-xs text-brand-muted mt-0.5">
                      {inv.number ?? inv.id}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-brand-black">{fmt(inv.amount_due)}</span>
                    <span className={clsx("badge text-xs", INV_STATUS_STYLES[inv.status ?? ""] ?? "badge-neutral")}>
                      {inv.status}
                    </span>
                    <a
                      href={inv.hosted_invoice_url ?? `${stripeBase}/invoices/${inv.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-brand-muted underline underline-offset-2 hover:text-brand-black"
                    >
                      View ↗
                    </a>
                    {canRefund && (
                      <button
                        onClick={() => setRefundInvoice(inv)}
                        className="text-xs text-red-500 underline underline-offset-2 hover:opacity-70"
                      >
                        Refund
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-brand-border text-xs text-brand-muted">
                  {inv.created && <span>{fmtDate(inv.created)}</span>}
                  {(inv.attempt_count ?? 0) > 1 && (
                    <span className="text-red-400">{inv.attempt_count} attempts</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Customers */}
      {!loading && tab === "customers" && data && (
        <div className="space-y-3">
          {data.customers.length === 0 ? (
            <div className="card text-center py-10 text-sm text-brand-muted">No customers yet.</div>
          ) : data.customers.map(cust => {
            const custSubs = data.subscriptions.filter(s =>
              (typeof s.customer === "string" ? s.customer : s.customer?.id) === cust.id
            );
            const activeSub = custSubs.find(s => s.status === "active" || s.status === "trialing");
            return (
              <div key={cust.id} className="card">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-medium text-brand-black">{cust.name || cust.email || cust.id}</p>
                    {cust.name && cust.email && (
                      <p className="text-xs text-brand-muted mt-0.5">{cust.email}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {activeSub && (
                      <span className="badge badge-success text-xs">active</span>
                    )}
                    {custSubs.length === 0 && (
                      <span className="badge badge-neutral text-xs">no subscription</span>
                    )}
                    <a
                      href={`${stripeBase}/customers/${cust.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-brand-muted underline underline-offset-2 hover:text-brand-black"
                    >
                      Stripe ↗
                    </a>
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-brand-border text-xs text-brand-muted">
                  <span>{custSubs.length} subscription{custSubs.length !== 1 ? "s" : ""}</span>
                  {cust.created && <span>Since {fmtDate(cust.created)}</span>}
                  <span className="ml-auto font-mono opacity-60">{cust.id}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Refunds */}
      {!loading && tab === "refunds" && data && (
        <div className="space-y-3">
          {data.refunds.length === 0 ? (
            <div className="card text-center py-10 text-sm text-brand-muted">No refunds yet.</div>
          ) : data.refunds.map(refund => {
            const pi = refund.payment_intent;
            const piId = typeof pi === "string" ? pi : pi?.id ?? null;
            return (
              <div key={refund.id} className="card">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-brand-black">{fmt(refund.amount)}</p>
                    <p className="text-xs text-brand-muted mt-0.5">
                      {REFUND_REASON_LABELS[refund.reason ?? ""] ?? refund.reason ?? "No reason"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={clsx("badge text-xs", REFUND_STATUS_STYLES[refund.status ?? ""] ?? "badge-neutral")}>
                      {refund.status}
                    </span>
                    {piId && (
                      <a
                        href={`${stripeBase}/payments/${piId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brand-muted underline underline-offset-2 hover:text-brand-black"
                      >
                        Payment ↗
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-brand-border text-xs text-brand-muted">
                  {refund.created && <span>{fmtDate(refund.created)}</span>}
                  <span className="font-mono opacity-60">{refund.id}</span>
                  {piId && <span className="ml-auto font-mono opacity-60">{piId}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {refundInvoice && (
        <RefundModal
          invoice={refundInvoice}
          mode={mode}
          onClose={() => setRefundInvoice(null)}
          onDone={() => { setRefundInvoice(null); load(mode); }}
        />
      )}
    </div>
  );
}
