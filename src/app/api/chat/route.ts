import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60;

type AgentConfig = {
  urlEnv: string;
  secretEnv: string;
  path: string;
};

const AGENT_CONFIG: Record<string, AgentConfig> = {
  jordan: {
    urlEnv: "JORDAN_API_URL",
    secretEnv: "JORDAN_WEBHOOK_SECRET",
    path: "/chat",
  },
  avery: {
    urlEnv: "AVERY_AGENT_URL",
    secretEnv: "AVERY_WEBHOOK_SECRET",
    path: "/chat",
  },
  riley: {
    urlEnv: "RILEY_AGENT_URL",
    secretEnv: "RILEY_WEBHOOK_SECRET",
    path: "/chat",
  },
};

export async function POST(req: NextRequest) {
  try {
    const { message, agent, chatId } = await req.json();

    if (!message || !agent) {
      return NextResponse.json({ error: "Missing message or agent" }, { status: 400 });
    }

    const config = AGENT_CONFIG[agent];
    if (!config) {
      return NextResponse.json({ error: `Unknown agent: ${agent}` }, { status: 400 });
    }

    const agentUrl = process.env[config.urlEnv] ?? "";
    const secret = process.env[config.secretEnv] ?? "";

    if (!agentUrl) {
      return NextResponse.json(
        { error: `${agent} agent URL not configured (${config.urlEnv})` },
        { status: 500 }
      );
    }

    const sessionChatId = chatId || "dashboard_brian";

    const res = await fetch(`${agentUrl}${config.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": secret,
      },
      body: JSON.stringify({ text: message, chatId: sessionChatId }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${agent} returned ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    return NextResponse.json({ response: data.response ?? "(no response)", agent });
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
