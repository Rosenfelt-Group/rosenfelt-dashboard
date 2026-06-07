import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Build plan Phase 2.4 — dashboard control for the per-agent runtime knobs in
// agent_config (set in Phase 2.1/2.2). Mirrors /api/usage/budget. Bounds match
// the DB CHECK constraints so a UI typo can't write a pathological value.
const BOUNDS: Record<string, { min: number; max: number; nullable?: boolean }> = {
  sonnet_max_tokens: { min: 1024, max: 64000 },
  haiku_max_tokens: { min: 256, max: 64000 },
  research_max_searches: { min: 1, max: 100 },
  iteration_cap: { min: 1, max: 200, nullable: true },
};

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("agent_config")
      .select("agent, scope, sonnet_max_tokens, haiku_max_tokens, research_max_searches, iteration_cap, updated_at")
      .eq("scope", "global")
      .order("agent");
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("Agent config GET error:", err);
    return NextResponse.json({ error: "Failed to load agent config" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { agent } = body;
    if (!agent || typeof agent !== "string") {
      return NextResponse.json({ error: "Missing agent" }, { status: 400 });
    }

    const updates: Record<string, number | null> = {};
    for (const [field, bound] of Object.entries(BOUNDS)) {
      if (!(field in body)) continue;
      const v = body[field];
      if (v === null && bound.nullable) {
        updates[field] = null;
        continue;
      }
      if (typeof v !== "number" || !Number.isInteger(v) || v < bound.min || v > bound.max) {
        return NextResponse.json(
          { error: `${field} must be an integer between ${bound.min} and ${bound.max}` },
          { status: 400 },
        );
      }
      updates[field] = v;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("agent_config")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("agent", agent)
      .eq("scope", "global")
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    console.error("Agent config PATCH error:", err);
    return NextResponse.json({ error: "Failed to update agent config" }, { status: 500 });
  }
}
