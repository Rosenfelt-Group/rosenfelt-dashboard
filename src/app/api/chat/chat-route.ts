import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const { message, agent, chatId } = await req.json();

    if (!message || !agent) {
      return NextResponse.json({ error: "Missing message or agent" }, { status: 400 });
    }

    // Only Jordan is on LangGraph for now
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

    // Use a consistent dashboard chat ID
    const sessionChatId = chatId || "dashboard_brian";

    // Forward to Jordan agent
    const res = await fetch(`${agentUrl}/webhook/jordan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": secret || "",
      },
      body: JSON.stringify({
        text: message,
        chatId: sessionChatId,
        botToken: "", // dashboard chat — no Telegram bot needed
      }),
    });

    if (!res.ok) {
      throw new Error(`Jordan agent returned ${res.status}`);
    }

    // Jordan processes async and responds via Telegram normally
    // For dashboard chat we need to poll Supabase for the response
    // Wait for Jordan to write the assistant turn to conversations
    await new Promise((resolve) => setTimeout(resolve, 8000));

    // Fetch the latest assistant response from Supabase
    const { data } = await supabaseAdmin
      .from("conversations")
      .select("content, created_at")
      .eq("session_id", `jordan_${sessionChatId}`)
      .eq("agent", "jordan")
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .limit(1);

    const response = data?.[0]?.content || "Jordan is processing your request...";

    return NextResponse.json({ response, agent });
  } catch (err) {
    console.error("Chat API error:", err);
    return NextResponse.json({ error: "Failed to reach agent" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  // Load chat history for a session
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
