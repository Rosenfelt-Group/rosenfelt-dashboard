import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { IssueAccessSchema } from "@/lib/rooms/schemas";
import { generateToken, hashToken, roomLink } from "@/lib/rooms/token";
import { requirePermission } from "@/lib/requirePermission";

const rooms = () => supabaseAdmin.schema("rooms");
type Ctx = { params: Promise<{ id: string }> };

// GET — list links (never returns tokens or hashes).
export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { data, error } = await rooms().from("engagement_access")
    .select("id, label, expires_at, revoked_at, last_used_at, created_at")
    .eq("engagement_id", id).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST — issue a link. The raw token is returned exactly once and never stored.
export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const parsed = IssueAccessSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { data: eng } = await rooms().from("engagements").select("id, status").eq("id", id).single();
  if (!eng) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  if (eng.status === "closed") return NextResponse.json({ error: "Engagement is closed" }, { status: 409 });

  const raw = generateToken();
  const expires_at = new Date(Date.now() + parsed.data.expires_days * 86_400_000).toISOString();
  const { data, error } = await rooms().from("engagement_access")
    .insert({ engagement_id: id, token_hash: hashToken(raw), label: parsed.data.label ?? null, expires_at })
    .select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id, link: roomLink(raw), expires_at }, { status: 201 });
}

// DELETE ?access_id=… — revoke.
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const accessId = req.nextUrl.searchParams.get("access_id");
  if (!accessId) return NextResponse.json({ error: "access_id required" }, { status: 400 });
  const { error } = await rooms().from("engagement_access")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", accessId).eq("engagement_id", id).is("revoked_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
