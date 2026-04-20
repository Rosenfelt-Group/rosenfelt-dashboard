import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
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