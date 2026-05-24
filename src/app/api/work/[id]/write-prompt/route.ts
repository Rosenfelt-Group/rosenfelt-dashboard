import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { AGENT_SECRETS, dispatchUrl } from "@/lib/agent-urls";

// Always routes to Jordan — Jordan is the dedicated prompt-writer regardless
// of who the work item is assigned to. Jordan's handle_work_item_dispatch
// (action="write_prompt") writes the result back to work_items.prompt and
// sets status='prompt_ready'. The UI picks up the change via Realtime on
// work_items, so this route returns 202 immediately.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // 1. Fetch the full work item
  const { data: item, error: itemErr } = await supabaseAdmin
    .from("work_items")
    .select("*")
    .eq("id", id)
    .single();
  if (itemErr || !item) {
    return NextResponse.json({ error: "work item not found" }, { status: 404 });
  }

  // 2. Linked docs (via doc_registry.work_item_id FK)
  const { data: linkedDocs } = await supabaseAdmin
    .from("doc_registry")
    .select("name, path, description, google_doc_url, category")
    .eq("work_item_id", id);

  // 3. Recent log entries (last 5, newest first)
  const { data: recentLogs } = await supabaseAdmin
    .from("work_item_logs")
    .select("author, author_type, entry_type, message, created_at")
    .eq("work_item_id", id)
    .order("created_at", { ascending: false })
    .limit(5);

  // 4. Assigned agent's system prompt (for context — null if unassigned)
  let assignedAgentPrompt: string | null = null;
  if (item.assigned_agent && item.assigned_agent !== "brian") {
    const { data: promptRow } = await supabaseAdmin
      .from("agent_prompts")
      .select("prompt")
      .eq("agent", item.assigned_agent)
      .single();
    assignedAgentPrompt = promptRow?.prompt ?? null;
  }

  // 5. Dispatch to Jordan
  const url = dispatchUrl("jordan");
  const secret = AGENT_SECRETS.jordan;
  if (!url || !secret) {
    return NextResponse.json(
      { error: "Jordan not configured (URL or secret missing)" },
      { status: 500 },
    );
  }

  const instruction =
    "Write a comprehensive Claude Code prompt for this work item. Include: " +
    "full context section describing the current system state, specific task " +
    "definition, files to read first, step-by-step implementation guidance, " +
    "acceptance criteria, and known constraints/gotchas from arch_notes. " +
    "Be thorough — thin prompts cause failed builds.";

  // Fire-and-forget; Jordan's handle_work_item_dispatch updates work_items
  // and the dashboard's Realtime subscription reflects it.
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
    body: JSON.stringify({
      source: "work_items",
      action: "write_prompt",
      work_item_id: id,
      title: item.title,
      description: item.description,
      summary: item.summary,
      work_type: item.work_type,
      priority: item.priority,
      prompt: item.prompt,
      // Rich context for Jordan's prompt writing
      work_item: item,
      linked_docs: linkedDocs ?? [],
      recent_logs: recentLogs ?? [],
      assigned_agent_prompt: assignedAgentPrompt,
      instruction,
      // Jordan should still Telegram-ping Brian when the prompt is ready.
      suppress_notify: false,
    }),
  }).catch((e) => console.error("write-prompt dispatch failed:", e));

  return NextResponse.json({ requested: true }, { status: 202 });
}
