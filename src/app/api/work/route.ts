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
    // itemType: undefined or "internal" → internal only (default), "client" → client only, "all" → no filter
    const itemType = searchParams.get("itemType");
    // Free-text search across title/description/summary. When present, the default
    // scope excludes closed/cancelled statuses; searchAll=1 includes every status.
    const search = (searchParams.get("q") ?? "").trim();
    const searchAll = searchParams.get("searchAll") === "1";

    let q = supabaseAdmin.from("work_items").select("*");

    if (status) q = q.eq("status", status);
    if (workType) q = q.eq("work_type", workType);
    if (assignedAgent) q = q.eq("assigned_agent", assignedAgent);
    if (priority) q = q.eq("priority", priority);
    if (archived === "true") q = q.eq("archived", true);
    else if (archived === "false") q = q.eq("archived", false);
    if (itemType === "client") q = q.eq("work_item_type", "client");
    else if (itemType !== "all") q = q.eq("work_item_type", "internal");

    if (search) {
      // Sanitize: strip characters that have meaning in PostgREST's or()/ilike
      // filter grammar so a stray comma or paren can't break the query.
      const safe = search.replace(/[(),%*]/g, " ").replace(/\s+/g, " ").trim();
      if (safe) {
        const pattern = `%${safe}%`;
        q = q.or(
          `title.ilike.${pattern},description.ilike.${pattern},summary.ilike.${pattern}`,
        );
      }
      // Default search hides terminal statuses; the all-statuses flag lifts that.
      if (!searchAll) {
        q = q.not("status", "in", "(done,cancelled,rejected)");
      }
    }

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

    // Default due date: 30 days from creation, formatted as YYYY-MM-DD
    const defaultDueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const insert = {
      title: body.title,
      description: body.description ?? null,
      summary: body.summary ?? null,
      work_type: body.work_type,
      priority: body.priority ?? "medium",
      status: body.status ?? "inbox",
      assigned_agent: body.assigned_agent ?? "riley",
      suggested_by: body.suggested_by ?? null,
      prompt: body.prompt ?? null,
      arch_notes: body.arch_notes ?? null,
      due_date: body.due_date ?? defaultDueDate,
      // 2026-05-26: client work item support
      work_item_type: body.work_item_type ?? "internal",
      sprint_number: body.sprint_number ?? null,
      client_id: body.client_id ?? null,
      source: body.source ?? "manual",
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
