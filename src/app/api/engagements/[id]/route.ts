import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/engagements/[id] — engagement, org name, deliverables with versions.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rooms = supabaseAdmin.schema("rooms");

  const { data: eng, error } = await rooms.from("engagements").select("*").eq("id", id).single();
  if (error || !eng) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });

  const [{ data: biz }, { data: deliverables, error: dErr }] = await Promise.all([
    supabaseAdmin.schema("crm").from("businesses").select("id, name, industry").eq("id", eng.business_id).single(),
    rooms.from("deliverables")
      .select("id, title, description, kind, sort_order, welcome_message, versions:deliverable_versions(id, version_no, status, change_summary, built_by_agent, manifest, created_at)")
      .eq("engagement_id", id)
      .order("sort_order"),
  ]);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  const out = (deliverables ?? []).map(d => ({
    ...d,
    versions: [...(d.versions ?? [])].sort((a, b) => b.version_no - a.version_no),
  }));
  return NextResponse.json({ engagement: eng, business: biz ?? null, deliverables: out });
}
