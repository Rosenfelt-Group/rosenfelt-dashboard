import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/crm/clients?status=active|inactive|all
// status semantics (default 'all' for backwards-compat with existing callers):
//   active   → client has at least one client_services row with status='active'
//   inactive → client has no client_services row with status='active'
//   all      → unfiltered
//
// PostgREST doesn't expose EXISTS directly, so we fetch the ID set of active
// clients once (single small query) and filter in-app. With <1000 clients
// this is cheaper than per-row N+1 joins and keeps the response shape stable.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? "all";

  const { data: allClients, error: cErr } = await supabaseAdmin
    .schema("crm")
    .from("clients")
    .select("*, business:businesses(*), contact:contacts(*)")
    .order("created_at", { ascending: false });
  if (cErr) {
    console.error("clients list:", cErr);
    return NextResponse.json([], { status: 500 });
  }

  if (status === "all" || !allClients?.length) {
    return NextResponse.json(allClients ?? []);
  }

  const { data: activeRows, error: sErr } = await supabaseAdmin
    .schema("crm")
    .from("client_services")
    .select("client_id")
    .eq("status", "active");
  if (sErr) {
    console.error("client_services lookup for client filter:", sErr);
    return NextResponse.json(allClients ?? []);
  }
  const activeIds = new Set((activeRows ?? []).map((r) => r.client_id));

  const filtered = allClients.filter((c) =>
    status === "active" ? activeIds.has(c.id) : !activeIds.has(c.id),
  );
  return NextResponse.json(filtered);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("clients")
    .insert(body)
    .select("*, business:businesses(*), contact:contacts(*)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
