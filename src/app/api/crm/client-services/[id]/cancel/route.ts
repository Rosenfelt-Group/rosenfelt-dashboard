import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getStripe } from "@/lib/stripe";

// POST /api/crm/client-services/[id]/cancel
// Body: { effective_date: 'YYYY-MM-DD' }
//
// Two modes based on the effective date:
//   - today or past → cancel NOW. Local row flips to 'cancelled' immediately.
//     If a Stripe subscription exists, it's cancelled immediately too.
//   - future → schedule cancellation. Local row stays 'active' for now;
//     billing_end_date is set. If a Stripe sub exists, schedule via cancel_at.
//     The customer.subscription.deleted webhook will flip the row to 'cancelled'
//     when the date arrives.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { effective_date?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.effective_date) {
    return NextResponse.json({ error: "effective_date (YYYY-MM-DD) is required" }, { status: 400 });
  }
  const targetTs = Date.parse(`${body.effective_date}T00:00:00Z`);
  if (Number.isNaN(targetTs)) {
    return NextResponse.json({ error: "Invalid effective_date" }, { status: 400 });
  }
  // "Today or past" = anything up to the END of today UTC. (If someone enters
  // today's date, treat as immediate.)
  const todayEndUtc = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
    23, 59, 59,
  );
  const immediate = targetTs <= todayEndUtc;

  const { data: service, error: fetchErr } = await supabaseAdmin
    .schema("crm")
    .from("client_services")
    .select("id, status, stripe_subscription_id")
    .eq("id", id)
    .single();
  if (fetchErr) {
    if (fetchErr.code === "PGRST116") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (service.status === "cancelled") {
    return NextResponse.json({ error: "Already cancelled" }, { status: 409 });
  }

  const stripe = getStripe();

  // Stripe-side action — only if a real subscription exists. T&M / one_time
  // services with no subscription just have their local row updated.
  if (service.stripe_subscription_id) {
    try {
      if (immediate) {
        await stripe.subscriptions.cancel(service.stripe_subscription_id);
      } else {
        await stripe.subscriptions.update(service.stripe_subscription_id, {
          cancel_at: Math.floor(targetTs / 1000),
        });
      }
    } catch (e) {
      console.error("Stripe cancellation failed:", e);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Stripe cancellation failed" },
        { status: 500 },
      );
    }
  }

  // Local-side writeback
  const update: Record<string, unknown> = { billing_end_date: body.effective_date };
  if (immediate) {
    update.status = "cancelled";
  }
  // For scheduled cancellation we leave status='active'; customer.subscription.deleted
  // webhook flips it on the effective date. For services without a Stripe subscription
  // (T&M, never-activated), we have no webhook to fall back on — flip the local row
  // immediately too so it doesn't sit forever.
  if (!immediate && !service.stripe_subscription_id) {
    update.status = "cancelled";
  }

  const { data, error: updErr } = await supabaseAdmin
    .schema("crm")
    .from("client_services")
    .update(update)
    .eq("id", id)
    .select("*, service_template:service_templates(*)")
    .single();
  if (updErr) {
    console.error("client_services cancel writeback failed:", updErr);
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    immediate,
    effective_date: body.effective_date,
    service: data,
  });
}
