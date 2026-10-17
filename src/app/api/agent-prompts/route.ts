import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";

export async function GET(request: NextRequest) {
  const guard = await requirePermission(request, "view_intelligence");
  if (!guard.ok) return guard.response;
  const agent = request.nextUrl.searchParams.get("agent");
  if (!agent) return NextResponse.json({ error: "agent required" }, { status: 400 });

  const { data, error } = await supabase
    .from("agent_prompts")
    .select("*")
    .eq("agent", agent)
    .single();

  if (error) return NextResponse.json(null);
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, "manage_intelligence");
  if (!guard.ok) return guard.response;
  const { agent, prompt, note } = await request.json();
  if (!agent || !prompt) return NextResponse.json({ error: "agent and prompt required" }, { status: 400 });

  const { data, error } = await supabase
    .from("agent_prompts")
    .upsert({ agent, prompt, updated_at: new Date().toISOString(), updated_by: guard.username },
             { onConflict: "agent" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("agent_prompt_versions").insert({
    agent,
    prompt,
    updated_by: guard.username,
    note: note || null,
  });

  return NextResponse.json(data);
}
