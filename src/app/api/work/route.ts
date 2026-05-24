import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const workType = searchParams.get("work_type");
    const assignedAgent = searchParams.get("assigned_agent");
    const priority = searchParams.get("priority");
    const archived = searchParams.get("archived");

    let q = supabaseAdmin.from("work_items").select("*");

    if (status) q = q.eq("status", status);
    if (workType) q = q.eq("work_type", workType);
    if (assignedAgent) q = q.eq("assigned_agent", assignedAgent);
    if (priority) q = q.eq("priority", priority);
    if (archived === "true") q = q.eq("archived", true);
    else if (archived === "false") q = q.eq("archived", false);

    q = q.order("updated_at", { ascending: false }).limit(500);

    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("Work list error:", err);
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.title || !body.work_type) {
      return NextResponse.json({ error: "title and work_type are required" }, { status: 400 });
    }

    const insert = {
      title: body.title,
      description: body.description ?? null,
      summary: body.summary ?? null,
      work_type: body.work_type,
      priority: body.priority ?? "medium",
      status: body.status ?? "inbox",
      assigned_agent: body.assigned_agent ?? null,
      suggested_by: body.suggested_by ?? null,
      prompt: body.prompt ?? null,
      arch_notes: body.arch_notes ?? null,
      due_date: body.due_date ?? null,
    };

    const { data, error } = await supabaseAdmin
      .from("work_items")
      .insert(insert)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("Work create error:", err);
    return NextResponse.json({ error: "Failed to create work item" }, { status: 500 });
  }
}
