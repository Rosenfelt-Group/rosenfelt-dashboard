import { redirect } from "next/navigation";
import { orgTabForBusinessTab } from "@/lib/crm/org-tabs";

// A business is an organization; its id is the organization id. Old ?tab= values map onto the new tabs.
export default async function BusinessDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const tab = orgTabForBusinessTab(typeof sp.tab === "string" ? sp.tab : null);
  redirect(`/crm/organizations/${encodeURIComponent(id)}${tab ? `?tab=${tab}` : ""}`);
}
