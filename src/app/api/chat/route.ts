import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60;

const JORDAN_API_URL = process.env.JORDAN_API_URL ?? "";
const JORDAN_WEBHOOK_SECRET = process.env.JORDAN_WEBHOOK_SECRET ?? "";

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

    if (!JORDAN_API_URL) {
      return NextResponse.json({ error: "Jordan agent URL not configured" }, { status: 500 });
    }

    const sessionChatId = chatId || "dashboard_brian";

    const res = await fetch(`${JORDAN_API_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": JORDAN_WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        text: message,
        chatId: sessionChatId,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Jordan returned ${res.status}: ${body}`);
    }

    const data = await res.json();
    return NextResponse.json({ response: data.response, agent });
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
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
