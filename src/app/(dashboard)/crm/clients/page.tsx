import { redirect } from "next/navigation";

// Clients are organizations with a client record. ?stripe=success|cancelled came from Stripe Checkout.
export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const p = new URLSearchParams({ status: sp.status === "inactive" ? "past_client" : sp.status === "all" ? "all" : "client" });
  if (p.get("status") === "all") p.delete("status");
  if (typeof sp.stripe === "string") p.set("stripe", sp.stripe);
  const qs = p.toString();
  redirect(qs ? `/crm/organizations?${qs}` : "/crm/organizations");
}
