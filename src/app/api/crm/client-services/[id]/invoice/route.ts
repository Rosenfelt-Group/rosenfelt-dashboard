import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getStripe } from "@/lib/stripe";

// POST /api/crm/client-services/[id]/invoice
// Body: { invoice_type: 'one_time' | 'tm_monthly', description?, amount? }
//
// one_time: single line item, customer-supplied description + amount (dollars).
// tm_monthly: pulls all unbilled crm.tm_billing_entries for this service,
//   bills as one invoice with one line item per entry, marks them billed.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { invoice_type?: string; description?: string; amount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.invoice_type || !["one_time", "tm_monthly"].includes(body.invoice_type)) {
    return NextResponse.json({ error: "invoice_type must be 'one_time' or 'tm_monthly'" }, { status: 400 });
  }

  // Fetch the service + client's stripe_customer_id
  const { data: service, error: fetchErr } = await supabaseAdmin
    .schema("crm")
    .from("client_services")
    .select("id, hourly_rate, client:clients(stripe_customer_id), service_template:service_templates(name)")
    .eq("id", id)
    .single();
  if (fetchErr) {
    if (fetchErr.code === "PGRST116") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  const client = Array.isArray(service.client) ? service.client[0] : service.client;
  if (!client?.stripe_customer_id) {
    return NextResponse.json({ error: "Client has no stripe_customer_id" }, { status: 422 });
  }
  const stripe = getStripe();

  // ─── one_time ────────────────────────────────────────────────────────────
  if (body.invoice_type === "one_time") {
    if (!body.description || typeof body.amount !== "number") {
      return NextResponse.json({ error: "description and amount required for one_time" }, { status: 400 });
    }
    try {
      const inv = await stripe.invoices.create({
        customer: client.stripe_customer_id,
        description: body.description,
        collection_method: "send_invoice",
        days_until_due: 30,
        metadata: { client_service_id: id },
      });
      if (!inv.id) {
        return NextResponse.json({ error: "Stripe invoice has no id" }, { status: 500 });
      }
      await stripe.invoiceItems.create({
        customer: client.stripe_customer_id,
        invoice: inv.id,
        amount: Math.round(body.amount * 100),
        currency: "usd",
        description: body.description,
      });
      const finalized = await stripe.invoices.finalizeInvoice(inv.id);
      if (!finalized.id) {
        return NextResponse.json({ error: "Finalized invoice has no id" }, { status: 500 });
      }
      const sent = await stripe.invoices.sendInvoice(finalized.id);
      return NextResponse.json({
        success: true,
        invoice_id: sent.id,
        invoice_url: sent.hosted_invoice_url,
        status: sent.status,
      });
    } catch (e) {
      console.error("Stripe one_time invoice failed:", e);
      return NextResponse.json({ error: e instanceof Error ? e.message : "Stripe error" }, { status: 500 });
    }
  }

  // ─── tm_monthly ──────────────────────────────────────────────────────────
  if (!service.hourly_rate) {
    return NextResponse.json({ error: "Service has no hourly_rate set" }, { status: 422 });
  }
  const tmpl = Array.isArray(service.service_template) ? service.service_template[0] : service.service_template;

  const { data: entries, error: entriesErr } = await supabaseAdmin
    .schema("crm")
    .from("tm_billing_entries")
    .select("*")
    .eq("client_service_id", id)
    .eq("billed", false)
    .order("entry_date", { ascending: true });
  if (entriesErr) {
    console.error("tm_billing_entries lookup failed:", entriesErr);
    return NextResponse.json({ error: entriesErr.message }, { status: 500 });
  }
  if (!entries || entries.length === 0) {
    return NextResponse.json({ error: "No unbilled hours to invoice" }, { status: 400 });
  }

  try {
    const invoiceDescription = `${tmpl?.name ?? "T&M Consulting"} — ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
    const inv = await stripe.invoices.create({
      customer: client.stripe_customer_id,
      description: invoiceDescription,
      collection_method: "send_invoice",
      days_until_due: 30,
      metadata: { client_service_id: id, type: "tm_monthly" },
    });
    if (!inv.id) {
      return NextResponse.json({ error: "Stripe invoice has no id" }, { status: 500 });
    }
    const hourlyRate = service.hourly_rate;
    for (const e of entries) {
      const amountCents = Math.round(Number(e.hours) * Number(hourlyRate) * 100);
      await stripe.invoiceItems.create({
        customer: client.stripe_customer_id,
        invoice: inv.id,
        amount: amountCents,
        currency: "usd",
        description: `${e.description} (${e.hours} hrs @ $${hourlyRate}/hr)`,
      });
    }
    const finalized = await stripe.invoices.finalizeInvoice(inv.id);
    if (!finalized.id) {
      return NextResponse.json({ error: "Finalized invoice has no id" }, { status: 500 });
    }
    const sent = await stripe.invoices.sendInvoice(finalized.id);

    // Mark entries billed + record the invoice id
    const ids = entries.map((e) => e.id);
    await supabaseAdmin
      .schema("crm")
      .from("tm_billing_entries")
      .update({ billed: true, stripe_invoice_id: sent.id })
      .in("id", ids);

    const today = new Date().toISOString().slice(0, 10);
    await supabaseAdmin
      .schema("crm")
      .from("client_services")
      .update({ last_billed_at: today })
      .eq("id", id);

    return NextResponse.json({
      success: true,
      invoice_id: sent.id,
      invoice_url: sent.hosted_invoice_url,
      status: sent.status,
      entries_billed: entries.length,
    });
  } catch (e) {
    console.error("Stripe tm_monthly invoice failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Stripe error" }, { status: 500 });
  }
}
