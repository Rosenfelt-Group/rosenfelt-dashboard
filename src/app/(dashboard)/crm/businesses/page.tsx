import { redirect } from "next/navigation";

// Businesses and clients are one list now.
export default async function BusinessesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = (await searchParams).q;
  redirect(typeof q === "string" && q ? `/crm/organizations?q=${encodeURIComponent(q)}` : "/crm/organizations");
}
