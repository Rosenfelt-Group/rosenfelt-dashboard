import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const { message, agent, chatId } = await req.json();

    if (!message || !agent) {
      return NextResponse.json({ error: "Missing message or agent" }, { status: 400 });
    }

    if (agent !== "jordan") {
      return NextResponse.json({
        response: `${agent} is not yet migrated to the new stack. Use Telegram to reach ${agent} for now.`,
        agent,
      });
    }

    const agentUrl = process.env.JORDAN_AGENT_URL;
    const secret = process.env.JORDAN_WEBHOOK_SECRET;

    if (!agentUrl) {
      return NextResponse.json({ error: "Jordan agent URL not configured" }, { status: 500 });
    }

    const sessionChatId = chatId || "dashboard_brian";

    // Record timestamp BEFORE sending so we only fetch the NEW response
    const sentAt = new Date().toISOString();

    const res = await fetch(`${agentUrl}/webhook/jordan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": secret || "",
      },
      body: JSON.stringify({
        text: message,
        chatId: sessionChatId,
        botToken: "",
      }),
    });

    if (!res.ok) {
      throw new Error(`Jordan agent returned ${res.status}`);
    }

    // Poll for the response — check every second for up to 30 seconds
    let response = "";
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const { data } = await supabaseAdmin
        .from("conversations")
        .select("content, created_at")
        .eq("session_id", `jordan_${sessionChatId}`)
        .eq("agent", "jordan")
        .eq("role", "assistant")
        .gte("created_at", sentAt)          // only messages AFTER we sent
        .order("created_at", { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        response = data[0].content;
        break;
      }
    }

    if (!response) {
      response = "Jordan is taking longer than expected. Check back in a moment or ask via Telegram.";
    }

    return NextResponse.json({ response, agent });
  } catch (err) {
    console.error("Chat API error:", err);
    return NextResponse.json({ error: "Failed to reach agent" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agent = searchParams.get("agent") || "jordan";
  const chatId = searchParams.get("chatId") || "dashboard_brian";

  try {
    const { data } = await supabaseAdmin
      .from("conversations")
      .select("role, content, created_at")
      .eq("session_id", `${agent}_${chatId}`)
      .eq("agent", agent)
      .order("created_at", { ascending: true })
      .limit(50);

    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json([], { status: 500 });
  }
}