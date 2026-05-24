import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { AGENT_SECRETS, dispatchUrl, isAgent, type AgentName } from "@/lib/agent-urls";

const MENTION_RE = /@(riley|jordan|avery|casey|brian)/gi;
const VALID_ENTRY_TYPES = new Set([
  "progress", "question", "answer", "note", "error", "completion",
]);

function parseMentions(message: string): string[] {
  const matches = Array.from(message.matchAll(MENTION_RE));
  return Array.from(new Set(matches.map((m) => m[1].toLowerCase())));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from("work_item_logs")
    .select("*")
    .eq("work_item_id", id)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ logs: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();

  const author = String(body.author || "").trim();
  const authorType = body.author_type === "agent" ? "agent" : "human";
  const entryType = String(body.entry_type || "note");
  const message = String(body.message || "").trim();
  const metadata = body.metadata ?? null;

  if (!author) return NextResponse.json({ error: "author required" }, { status: 400 });
  if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });
  if (!VALID_ENTRY_TYPES.has(entryType)) {
    return NextResponse.json({ error: `invalid entry_type: ${entryType}` }, { status: 400 });
  }

  const mentions = parseMentions(message);

  // Fetch work item context (title/desc/etc.) for downstream dispatches
  const { data: item, error: itemErr } = await supabaseAdmin
    .from("work_items")
    .select("id, title, description, summary, work_type, priority, prompt, assigned_agent")
    .eq("id", id)
    .single();
  if (itemErr || !item) {
    return NextResponse.json({ error: "work item not found" }, { status: 404 });
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("work_item_logs")
    .insert({
      work_item_id: id,
      author,
      author_type: authorType,
      entry_type: entryType,
      message,
      mentions,
      metadata,
    })
    .select()
    .single();
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // Dispatch to any @mentioned agents. isAgent narrows to AgentName which
  // does not include 'brian', so @brian mentions are excluded automatically.
  const agentsToNotify = mentions.filter(isAgent);
  await Promise.all(
    agentsToNotify.map(async (agentName) => {
      const url = dispatchUrl(agentName);
      const secret = AGENT_SECRETS[agentName];
      if (!url || !secret) return;
      try {
        await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Secret": secret,
          },
          body: JSON.stringify({
            source: "work_items",
            action: "mention",
            work_item_id: id,
            title: item.title,
            description: item.description,
            summary: item.summary,
            work_type: item.work_type,
            priority: item.priority,
            prompt: item.prompt,
            message,
          }),
        });
      } catch (e) {
        console.error(`Failed to dispatch mention to ${agentName}:`, e);
      }
    }),
  );

  return NextResponse.json({ log: inserted });
}
