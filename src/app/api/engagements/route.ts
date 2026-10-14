import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { CreateEngagementSchema } from "@/lib/rooms/schemas";
import { sessionUsername } from "@/lib/rooms/session-user";

const rooms = () => supabaseAdmin.schema("rooms");

// GET /api/engagements?business_id=…
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get("business_id");
  let q = rooms().from("engagements")
    .select("id, business_id, relationship, title, status, modules, created_by, created_at")
    .order("created_at", { ascending: false });
  if (businessId) q = q.eq("business_id", businessId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
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
