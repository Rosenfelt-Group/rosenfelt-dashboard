import { notFound, redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A client record lives on its organization's Billing tab. Stripe activation returns here with
// ?activated=<service id> or ?cancelled=<service id>; those are passed along.
export default async function ClientDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const { data } = await supabaseAdmin.schema("crm").from("clients").select("business_id").eq("id", id).maybeSingle();
  if (!data?.business_id) notFound();
  const p = new URLSearchParams({ tab: "billing", client: id });
  for (const k of ["activated", "cancelled"]) {
    const v = sp[k];
    if (typeof v === "string") p.set(k, v);
  }
  redirect(`/crm/organizations/${data.business_id}?${p}`);
}
