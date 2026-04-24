import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("budget_config")
      .select("agent, daily_budget_usd, updated_at")
      .order("agent");
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("Budget GET error:", err);
    return NextResponse.json({ error: "Failed to load budgets" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { agent, daily_budget_usd } = await req.json();
    if (!agent || typeof daily_budget_usd !== "number" || daily_budget_usd < 0) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin
      .from("budget_config")
      .update({ daily_budget_usd, updated_at: new Date().toISOString() })
      .eq("agent", agent)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    console.error("Budget PATCH error:", err);
    return NextResponse.json({ error: "Failed to update budget" }, { status: 500 });
  }
}
