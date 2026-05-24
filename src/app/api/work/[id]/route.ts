import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const EDITABLE_FIELDS = new Set([
  "title", "description", "summary", "work_type", "priority", "status",
  "assigned_agent", "suggested_by", "prompt", "arch_notes", "doc_path",
  "due_date", "archived",
]);

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { data, error } = await supabaseAdmin
      .from("work_items")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    console.error("Work get error:", err);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();

    const updates: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (EDITABLE_FIELDS.has(k)) updates[k] = v;
    }

    if (typeof updates.status === "string") {
      const nowIso = new Date().toISOString();
      const { data: current } = await supabaseAdmin
        .from("work_items")
        .select("status, approved_at, prompt_ready_at, completed_at")
        .eq("id", id)
        .single();

      if (updates.status === "approved" && !current?.approved_at) {
        updates.approved_at = nowIso;
      }
      if (updates.status === "prompt_ready" && !current?.prompt_ready_at) {
        updates.prompt_ready_at = nowIso;
      }
      if (updates.status === "done" && !current?.completed_at) {
        updates.completed_at = nowIso;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("work_items")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    console.error("Work update error:", err);
    return NextResponse.json({ error: "Failed to update work item" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { error } = await supabaseAdmin.from("work_items").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Work delete error:", err);
    return NextResponse.json({ error: "Failed to delete work item" }, { status: 500 });
  }
}
