import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  const { idea_id, title, description } = await req.json();
  if (!idea_id || !title) {
    return NextResponse.json({ error: "Missing idea_id or title" }, { status: 400 });
  }

  // Mark idea in_progress immediately so the UI reflects it
  const { error } = await supabaseAdmin
    .from("content_ideas")
    .update({ status: "in_progress" })
    .eq("id", idea_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fire Avery /draft — non-blocking, returns 202 after triggering
  const avUrl  = process.env.AVERY_AGENT_URL;
  const secret = process.env.AVERY_WEBHOOK_SECRET || process.env.JORDAN_WEBHOOK_SECRET;
  if (avUrl && secret) {
    fetch(`${avUrl}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
      body: JSON.stringify({ idea_id, title, description }),
    }).catch(err => console.error("Avery /draft call failed:", err));
  } else {
    console.warn("AVERY_AGENT_URL or webhook secret not configured — draft not triggered");
  }

  return NextResponse.json({ status: "drafting" });
}
