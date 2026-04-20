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
    .from("agent_prompts")
    .select("*")
    .eq("agent", agent)
    .single();

  if (error) return NextResponse.json(null);
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const { agent, prompt, note } = await request.json();
  if (!agent || !prompt) return NextResponse.json({ error: "agent and prompt required" }, { status: 400 });

  // Upsert current prompt
  const { data, error } = await supabase
    .from("agent_prompts")
    .upsert({ agent, prompt, updated_at: new Date().toISOString(), updated_by: "brian" },
             { onConflict: "agent" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Save version
  await supabase.from("agent_prompt_versions").insert({
    agent,
    prompt,
    updated_by: "brian",
    note: note || null,
  });

  return NextResponse.json(data);
}