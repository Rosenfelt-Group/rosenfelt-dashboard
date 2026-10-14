import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { CreateEngagementSchema } from "@/lib/rooms/schemas";
import { sessionUsername } from "@/lib/rooms/session-user";

const rooms = () => supabaseAdmin.schema("rooms");

// GET /api/engagements?business_id=…&limit=…
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const businessId = params.get("business_id");
  const parsedLimit = Number.parseInt(params.get("limit") ?? "", 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 1000) : 200;
  let q = rooms().from("engagements")
    .select("id, business_id, relationship, title, status, modules, created_by, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (businessId) q = q.eq("business_id", businessId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = data ?? [];
  if (rows.length === 0) return NextResponse.json([]);

  const ids = [...new Set(rows.map(r => r.business_id).filter(Boolean))];
  const names = new Map<string, { id: string; name: string }>();
  if (ids.length > 0) {
    const { data: biz, error: bizErr } = await supabaseAdmin.schema("crm")
      .from("businesses").select("id, name").in("id", ids);
    if (!bizErr) for (const b of biz ?? []) names.set(b.id, { id: b.id, name: b.name });
  }
  return NextResponse.json(rows.map(r => ({ ...r, business: names.get(r.business_id) ?? null })));
}

// POST /api/engagements
export async function POST(req: NextRequest) {
  const parsed = CreateEngagementSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { data, error } = await rooms().from("engagements")
    .insert({ ...parsed.data, created_by: await sessionUsername(req) })
    .select("id, title, relationship, status, modules, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
