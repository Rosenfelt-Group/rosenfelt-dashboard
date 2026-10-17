import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";

// Chat with an agent (and read its dashboard chat history) requires use_chat.
const CHAT_PERMISSION = "use_chat";

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
  casey: {
    urlEnv: "CASEY_AGENT_URL",
    secretEnv: "CASEY_WEBHOOK_SECRET",
    path: "/chat",
  },
  sam: {
    urlEnv: "SAM_AGENT_URL",
    secretEnv: "SAM_WEBHOOK_SECRET",
    path: "/chat",
  },
};

export async function POST(req: NextRequest) {
  const check = await requirePermission(req, CHAT_PERMISSION);
  if (!check.ok) return check.response;

  try {
    const { message, agent, chatId } = await req.json();

    if (!message || !agent) {
      return NextResponse.json({ error: "Missing message or agent" }, { status: 400 });
    }

    const config = Object.hasOwn(AGENT_CONFIG, agent) ? AGENT_CONFIG[agent] : undefined;
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
  const check = await requirePermission(req, CHAT_PERMISSION);
  if (!check.ok) return check.response;

  const { searchParams } = new URL(req.url);
  const agent = searchParams.get("agent") || "jordan";
  const chatId = searchParams.get("chatId") || "dashboard_brian";
  if (!Object.hasOwn(AGENT_CONFIG, agent)) {
    return NextResponse.json({ error: `Unknown agent: ${agent}` }, { status: 400 });
  }

  try {
    const { data } = await supabaseAdmin
      .from("conversations")
      .select("role, content, created_at")
      .eq("session_id", `${agent}_${chatId}`)
      .eq("agent", agent)
      .order("created_at", { ascending: false })
      .limit(50);

    return NextResponse.json((data ?? []).reverse());
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
