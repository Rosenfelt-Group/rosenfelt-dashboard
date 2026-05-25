import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

function getETDateString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const dateParam = searchParams.get("date");
  let selectedDate: string;

  if (dateParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
    }
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const minDate = getETDateString(thirtyDaysAgo);
    const maxDate = getETDateString();
    if (dateParam < minDate || dateParam > maxDate) {
      return NextResponse.json({ error: "Date must be within the last 30 days." }, { status: 400 });
    }
    selectedDate = dateParam;
  } else {
    selectedDate = getETDateString();
  }

  try {
    const [{ data: dailyRows, error: rpcError }, { data: budgets }] = await Promise.all([
      supabaseAdmin.rpc("get_daily_token_usage", { days: 30 }),
      supabaseAdmin.from("budget_config").select("agent, daily_budget_usd"),
    ]);

    if (rpcError) throw rpcError;

    const budgetMap: Record<string, number> = {};
    for (const b of budgets ?? []) {
      budgetMap[b.agent] = Number(b.daily_budget_usd);
    }

    const todayET = getETDateString();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = getETDateString(sevenDaysAgo);

    const rows = (dailyRows ?? []) as {
      agent: string; day: string; calls: number;
      prompt_tokens: number; completion_tokens: number; total_tokens: number; cost_usd: number;
    }[];

    const agents = ["jordan", "riley", "avery", "casey"];

    const agentSummary = agents.map(agent => {
      const agentRows = rows.filter(r => r.agent === agent);
      const selectedDayRows = agentRows.filter(r => r.day === selectedDate);
      const weekRows = agentRows.filter(r => r.day >= sevenDaysAgoStr && r.day <= todayET);

      const todayCost   = selectedDayRows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
      const todayTokens = selectedDayRows.reduce((s, r) => s + Number(r.total_tokens ?? 0), 0);
      const callsToday  = selectedDayRows.reduce((s, r) => s + Number(r.calls ?? 0), 0);
      const weekCost    = weekRows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
      const weekTokens  = weekRows.reduce((s, r) => s + Number(r.total_tokens ?? 0), 0);
      const dailyBudget = budgetMap[agent] ?? 1.0;

      return { agent, todayCost, todayTokens, weekCost, weekTokens, callsToday, dailyBudget };
    });

    const daily = rows
      .map(r => ({
        date: r.day,
        agent: r.agent,
        calls: Number(r.calls ?? 0),
        prompt_tokens: Number(r.prompt_tokens ?? 0),
        completion_tokens: Number(r.completion_tokens ?? 0),
        total_tokens: Number(r.total_tokens ?? 0),
        cost_usd: Number(r.cost_usd ?? 0),
      }))
      .sort((a, b) => b.date.localeCompare(a.date) || a.agent.localeCompare(b.agent));

    return NextResponse.json({ agents: agentSummary, daily, selected_date: selectedDate });
  } catch (err) {
    console.error("Usage API error:", err);
    return NextResponse.json({ error: "Failed to load usage data" }, { status: 500 });
  }
}
