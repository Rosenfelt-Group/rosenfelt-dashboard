import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const PAGE_SIZE = 50;
const DATE_FIELDS = new Set(["created_at", "updated_at", "due_date"]);

function csv(v: string | null): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

// GET /api/work/search — full-table work_items search for the Advanced Search
// drawer. All params optional; default scope is "everything except archived".
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const q = (searchParams.get("q") ?? "").trim();
    const agents = csv(searchParams.get("agent"));
    const types = csv(searchParams.get("type"));
    const priorities = csv(searchParams.get("priority"));
    const sources = csv(searchParams.get("source"));
    const statuses = csv(searchParams.get("status"));
    const phases = csv(searchParams.get("phase"));
    const itemType = searchParams.get("itemType");
    const dateFieldRaw = searchParams.get("dateField") ?? "updated_at";
    const dateField = DATE_FIELDS.has(dateFieldRaw) ? dateFieldRaw : "updated_at";
    const from = (searchParams.get("from") ?? "").trim();
    const to = (searchParams.get("to") ?? "").trim();
    const includeArchived = searchParams.get("includeArchived") === "1";
    const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);

    let query = supabaseAdmin.from("work_items").select("*", { count: "exact" });

    if (!includeArchived) query = query.eq("archived", false);

    if (itemType === "client") query = query.eq("work_item_type", "client");
    else if (itemType === "internal") query = query.eq("work_item_type", "internal");
    // "all"/absent → no work_item_type filter

    if (types.length) query = query.in("work_type", types);
    if (priorities.length) query = query.in("priority", priorities);
    if (sources.length) query = query.in("source", sources);
    if (statuses.length) query = query.in("status", statuses);

    // agent, honoring the "unassigned" sentinel
    const realAgents = agents.filter((a) => a !== "unassigned");
    const includeUnassigned = agents.includes("unassigned");
    if (realAgents.length && includeUnassigned) {
      query = query.or(`assigned_agent.in.(${realAgents.join(",")}),assigned_agent.is.null`);
    } else if (realAgents.length) {
      query = query.in("assigned_agent", realAgents);
    } else if (includeUnassigned) {
      query = query.is("assigned_agent", null);
    }

    // phase: integer buckets [N, N+1) plus the "none" (null) sentinel
    if (phases.length) {
      const clauses: string[] = [];
      for (const p of phases) {
        if (p === "none") { clauses.push("sprint_number.is.null"); continue; }
        const n = parseInt(p, 10);
        if (Number.isFinite(n)) clauses.push(`and(sprint_number.gte.${n},sprint_number.lt.${n + 1})`);
      }
      if (clauses.length) query = query.or(clauses.join(","));
    }

    // keyword across title/description/summary (sanitized for the or() grammar)
    if (q) {
      const safe = q.replace(/[(),%*]/g, " ").replace(/\s+/g, " ").trim();
      if (safe) {
        const pat = `%${safe}%`;
        query = query.or(`title.ilike.${pat},description.ilike.${pat},summary.ilike.${pat}`);
      }
    }

    // date range on the chosen field; date-only `to` is made inclusive
    if (from) query = query.gte(dateField, from);
    if (to) {
      const toVal = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to;
      query = query.lte(dateField, toVal);
    }

    query = query.order(dateField, { ascending: false }).range(offset, offset + PAGE_SIZE - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return NextResponse.json({ items: data ?? [], total: count ?? 0, offset, limit: PAGE_SIZE });
  } catch (err) {
    console.error("Work search error:", err);
    return NextResponse.json({ items: [], total: 0, offset: 0, limit: PAGE_SIZE }, { status: 500 });
  }
}
