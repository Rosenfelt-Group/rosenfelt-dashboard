import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";

export async function GET(request: NextRequest) {
  const guard = await requirePermission(request, "view_intelligence");
  if (!guard.ok) return guard.response;
  const agent = request.nextUrl.searchParams.get("agent");
  if (!agent) return NextResponse.json({ error: "agent required" }, { status: 400 });

  const { data, error } = await supabase
    .from("agent_prompt_versions")
    .select("*")
    .eq("agent", agent)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json([], { status: 500 });
  return NextResponse.json(data ?? []);
}