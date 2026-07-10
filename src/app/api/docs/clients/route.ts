import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/docs/clients
// Dropdown source for doc_registry.client_id. crm.clients has no name column
// of its own — it references crm.businesses(name) via business_id.
export async function GET() {
  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("clients")
    .select("id, businesses(name)")
    .order("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = { id: string; businesses: { name: string } | { name: string }[] | null };
  const clients = (data as Row[] ?? []).map((row) => {
    const biz = Array.isArray(row.businesses) ? row.businesses[0] : row.businesses;
    return { id: row.id, name: biz?.name ?? "(unnamed)" };
  });

  return NextResponse.json(clients);
}
