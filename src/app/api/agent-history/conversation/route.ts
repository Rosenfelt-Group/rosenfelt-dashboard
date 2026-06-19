import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Returns the conversation turns that produced a single workflow_logs
// execution. conversations is scoped by agent + session_id ("{agent}_{chat_id}");
// we bracket to the execution's time window so a long-lived session resolves
// to just the turns around this run.
//
// Query params:
//   agent       — required
//   session_id  — required (NULL on the log row → caller should not fetch)
//   at          — required, the log row's created_at (ISO) = end of the window
//   window      — optional, duration_ms of the execution (default 0)
//
// conversations has no anon SELECT policy, so this reads via the service role.
//
// Auth: enforced by src/middleware.ts, which requires a valid session cookie on
// every route not in its allowlist (this route is not allowlisted). Same model
// as the sibling /api/chat GET and /api/agent-history routes — any authenticated
// dashboard user can already see the full history feed; this adds the turn bodies
// at the same granularity. The dashboard is single-tenant (dashboard_users), so
// there is no per-user ownership boundary on agent conversations to enforce here.
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const agent = sp.get("agent");
  const sessionId = sp.get("session_id");
  const at = sp.get("at");
  const windowMs = Number(sp.get("window") ?? "0");

  if (!agent || !sessionId || !at) {
    return NextResponse.json(
      { error: "agent, session_id and at are required" },
      { status: 400 },
    );
  }

  const end = new Date(at);
  if (Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: "invalid 'at' timestamp" }, { status: 400 });
  }

  // Pad generously: the user turn is saved before the run starts, the assistant
  // turn just before created_at. 5 min lead covers slow tool-heavy turns + clock skew.
  const lead = (Number.isFinite(windowMs) ? windowMs : 0) + 5 * 60 * 1000;
  const start = new Date(end.getTime() - lead);
  const tail = new Date(end.getTime() + 60 * 1000);

  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("role, content, created_at")
    .eq("agent", agent)
    .eq("session_id", sessionId)
    .gte("created_at", start.toISOString())
    .lte("created_at", tail.toISOString())
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
