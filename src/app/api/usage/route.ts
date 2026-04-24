import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(parseInt(searchParams.get("days") ?? "7"), 90);
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  try {
    const [{ data: rows }, { data: budgets }] = await Promise.all([
      supabaseAdmin
        .from("token_usage")
        .select("agent, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, created_at")
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("budget_config")
        .select("agent, daily_budget_usd"),
    ]);

    const allRows = rows ?? [];
    const budgetMap: Record<string, number> = {};
    for (const b of budgets ?? []) {
      budgetMap[b.agent] = Number(b.daily_budget_usd);
    }

    const agents = ["jordan", "riley", "avery"];

    // Per-agent summary
    const agentSummary = agents.map(agent => {
      const agentRows = allRows.filter(r => r.agent === agent);
      const todayRows = agentRows.filter(r => r.created_at >= todayStart.toISOString());

      const todayCost   = todayRows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
      const todayTokens = todayRows.reduce((s, r) => s + (r.total_tokens ?? 0), 0);
      const weekCost    = agentRows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
      const weekTokens  = agentRows.reduce((s, r) => s + (r.total_tokens ?? 0), 0);
      const callsToday  = todayRows.length;
      const dailyBudget = budgetMap[agent] ?? 1.0;

      return { agent, todayCost, todayTokens, weekCost, weekTokens, callsToday, dailyBudget };
    });

    // Daily breakdown aggregated by agent+date
    type DailyKey = string;
    const dailyMap: Record<DailyKey, {
      date: string; agent: string; calls: number;
      prompt_tokens: number; completion_tokens: number; total_tokens: number; cost_usd: number;
    }> = {};

    for (const r of allRows) {
      const date = r.created_at.slice(0, 10);
      const key  = `${date}|${r.agent}`;
      if (!dailyMap[key]) {
        dailyMap[key] = { date, agent: r.agent, calls: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_usd: 0 };
      }
      dailyMap[key].calls++;
      dailyMap[key].prompt_tokens     += r.prompt_tokens ?? 0;
      dailyMap[key].completion_tokens += r.completion_tokens ?? 0;
      dailyMap[key].total_tokens      += r.total_tokens ?? 0;
      dailyMap[key].cost_usd          += Number(r.cost_usd ?? 0);
    }

    const daily = Object.values(dailyMap).sort((a, b) =>
      b.date.localeCompare(a.date) || a.agent.localeCompare(b.agent)
    );

    return NextResponse.json({ agents: agentSummary, daily });
  } catch (err) {
    console.error("Usage API error:", err);
    return NextResponse.json({ error: "Failed to load usage data" }, { status: 500 });
  }
}
