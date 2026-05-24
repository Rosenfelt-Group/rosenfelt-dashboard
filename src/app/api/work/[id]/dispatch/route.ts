import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { AGENT_SECRETS, dispatchUrl, isAgent, type AgentName } from "@/lib/agent-urls";

const VALID_ACTIONS = new Set(["begin_work", "write_prompt", "get_status", "mention"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const action = String(body.action || "");
  const message = body.message ? String(body.message) : undefined;
  const targetOverride = body.agent ? String(body.agent) : undefined;

  if (!VALID_ACTIONS.has(action)) {
    return NextResponse.json({ error: `invalid action: ${action}` }, { status: 400 });
  }

  const { data: item, error: itemErr } = await supabaseAdmin
    .from("work_items")
    .select("id, title, description, summary, work_type, priority, prompt, assigned_agent")
    .eq("id", id)
    .single();
  if (itemErr || !item) {
    return NextResponse.json({ error: "work item not found" }, { status: 404 });
  }

  const agentRaw = (targetOverride || item.assigned_agent || "").toLowerCase();
  // 'brian' is a legal AgentName for assigned_agent but NOT a dispatch target —
  // isAgent's union doesn't include it, so the type guard covers the brian case
  // implicitly. Both checks fall into the same 400.
  if (!isAgent(agentRaw)) {
    return NextResponse.json(
      { error: `cannot dispatch to '${agentRaw}' — assign to jordan/riley/avery/casey first` },
      { status: 400 },
    );
  }
  const agent: AgentName = agentRaw;

  const url = dispatchUrl(agent);
  const secret = AGENT_SECRETS[agent];
  if (!url || !secret) {
    return NextResponse.json(
      { error: `agent ${agent} not configured (missing URL or secret)` },
      { status: 500 },
    );
  }

  const payload: Record<string, unknown> = {
    source: "work_items",
    action,
    work_item_id: id,
    title: item.title,
    description: item.description,
    summary: item.summary,
    work_type: item.work_type,
    priority: item.priority,
    prompt: item.prompt,
  };
  if (message) payload.message = message;

  let dispatched = false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
      body: JSON.stringify(payload),
    });
    dispatched = res.ok;
  } catch (e) {
    console.error("dispatch failed:", e);
  }

  await supabaseAdmin.from("work_item_logs").insert({
    work_item_id: id,
    author: "brian",
    author_type: "human",
    entry_type: dispatched ? "note" : "error",
    message: dispatched
      ? `Dispatched to ${agent}: ${action}`
      : `Failed to dispatch to ${agent}: ${action}`,
    mentions: [agent],
  });

  return NextResponse.json({ dispatched, agent, action });
}
