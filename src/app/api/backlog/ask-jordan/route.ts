import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// Dashboard triggers Jordan to write a Claude Code prompt for an approved
// backlog item. Uses Jordan's fire-and-forget /backlog/ask-jordan endpoint
// so the serverless function returns in ~200ms regardless of how long
// Jordan's LangGraph loop takes. Jordan's write_backlog_prompt tool flips
// the row to prompt_ready; the 30s poll on /backlog picks it up.

export const maxDuration = 10;

const JORDAN_AGENT_URL = process.env.JORDAN_AGENT_URL ?? "";
const JORDAN_WEBHOOK_SECRET = process.env.JORDAN_WEBHOOK_SECRET ?? "";

export async function POST(req: NextRequest) {
  if (!JORDAN_AGENT_URL) {
    return NextResponse.json(
      { error: "JORDAN_AGENT_URL not configured" },
      { status: 503 }
    );
  }

  try {
    const { id } = await req.json();
    if (typeof id !== "number") {
      return NextResponse.json({ error: "id (number) required" }, { status: 400 });
    }

    const { data: item, error } = await supabaseAdmin
      .from("tool_backlog")
      .select("id, title, summary, problem_detail, affected_area, priority, bundle_id, status, doc_path")
      .eq("id", id)
      .single();

    if (error || !item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    if (item.status !== "approved") {
      return NextResponse.json(
        { error: `Item is in status '${item.status}', expected 'approved'` },
        { status: 409 }
      );
    }

    const bundleNote = item.bundle_id
      ? `\n\nThis item is part of bundle #${item.bundle_id}. Use your Supabase tools to look up any sibling items (tool_backlog.bundle_id = ${item.bundle_id}) and write a unified prompt covering all of them.`
      : "";

    const docNote = item.doc_path
      ? `\n\nA longer spec lives at docs path \`${item.doc_path}\` — read it via your /docs endpoint before writing the prompt.`
      : "";

    const text =
      `Write a Claude Code prompt for tool_backlog item ${item.id}: "${item.title}".\n\n` +
      `Summary: ${item.summary}\n\n` +
      (item.problem_detail ? `Problem detail:\n${item.problem_detail}\n\n` : "") +
      `Affected area: ${item.affected_area}. Priority: ${item.priority ?? "unset"}.` +
      bundleNote +
      docNote +
      `\n\nCall write_backlog_prompt(item_id=${item.id}, claude_code_prompt=..., arch_notes=...) to save your work. ` +
      `The prompt should be detailed enough for me to paste into Claude Code CLI and get a working implementation — repos to touch, files, acceptance criteria, migration steps. ` +
      `arch_notes should capture tradeoffs, risks, and adjacent systems. ` +
      `After saving, reply with a one-line confirmation.`;

    const res = await fetch(`${JORDAN_AGENT_URL}/backlog/ask-jordan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": JORDAN_WEBHOOK_SECRET,
      },
      body: JSON.stringify({ text, chatId: "dashboard_backlog" }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Jordan returned HTTP ${res.status}`, detail: detail.slice(0, 300) },
        { status: 502 }
      );
    }

    // Jordan returns {status: "accepted"} immediately; the actual prompt
    // write lands in Supabase when the LangGraph loop calls
    // write_backlog_prompt 30–60s later.
    return NextResponse.json({ ok: true, accepted: true });
  } catch (err) {
    console.error("ask-jordan error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to reach Jordan" },
      { status: 500 }
    );
  }
}
