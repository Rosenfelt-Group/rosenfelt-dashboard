import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getStripe } from "@/lib/stripe";

// POST /api/crm/clients/[id]/portal-link
// Body: { return_url?: string }
// Returns: { portal_url, expires_at }
//
// Creates a one-shot Stripe Customer Portal session. Portal is configured
// via /v1/billing_portal/configurations (Prompt 4 PART D set the default one).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { return_url?: string };
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const { data: client, error: fetchErr } = await supabaseAdmin
    .schema("crm")
    .from("clients")
    .select("id, stripe_customer_id")
    .eq("id", id)
    .single();
  if (fetchErr) {
    if (fetchErr.code === "PGRST116") {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!client.stripe_customer_id) {
    return NextResponse.json(
      { error: "Client has no stripe_customer_id — activate a service first" },
      { status: 422 },
    );
  }

  const baseUrl = process.env.DASHBOARD_BASE_URL ?? "https://dashboard.rosably.com";
  const returnUrl = body.return_url ?? `${baseUrl}/crm/clients/${id}`;

  try {
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: client.stripe_customer_id,
      return_url: returnUrl,
    });
    return NextResponse.json({
      portal_url: session.url,
      expires_at: session.created + (24 * 60 * 60), // Stripe portal sessions are valid for ~24h
    });
  } catch (e) {
    console.error("Stripe portal session failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Stripe error" }, { status: 500 });
  }
}
