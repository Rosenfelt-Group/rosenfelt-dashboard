import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { WorkItem, WorkItemLog } from "@/types";

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
    const items = (data ?? []) as WorkItem[];

    // Avoid N+1: fetch logs in a single query, then pick the newest per item.
    // (PostgREST has no DISTINCT ON, but order-desc + first-wins in JS is
    // equivalent and the data volume is small — up to 500 items × ~5 KB.)
    const itemIds = items.map((i) => i.id);
    const latestById = new Map<string, WorkItemLog>();
    if (itemIds.length > 0) {
      const { data: logRows, error: logErr } = await supabaseAdmin
        .from("work_item_logs")
        .select("id, work_item_id, created_at, author, author_type, entry_type, message, mentions, metadata")
        .in("work_item_id", itemIds)
        .order("created_at", { ascending: false });
      if (logErr) {
        console.error("Work logs join error:", logErr);
      } else {
        for (const row of (logRows ?? []) as WorkItemLog[]) {
          if (!latestById.has(row.work_item_id)) {
            latestById.set(row.work_item_id, row);
          }
        }
      }
    }

    const enriched = items.map((i) => ({ ...i, last_log: latestById.get(i.id) ?? null }));
    return NextResponse.json(enriched);
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
