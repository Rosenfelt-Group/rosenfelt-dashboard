import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { workItemIdFilter } from "@/lib/work-item-id";

const EDITABLE_FIELDS = new Set([
  "title", "description", "summary", "work_type", "priority", "status",
  "assigned_agent", "suggested_by", "prompt", "arch_notes",
  "due_date", "archived",
  // Phase 0.7: sprint_number is phase membership (freely editable on any item,
  // independent of source); source is origin/provenance. Both were previously
  // dropped on every PATCH, which is why items couldn't be moved between phases.
  "sprint_number", "source",
  // phase_step: text sub-step within a phase (e.g. "1.6"). Display + sort only.
  "phase_step",
]);

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { column, value } = workItemIdFilter(id);
    const { data, error } = await supabaseAdmin
      .from("work_items")
      .select("*")
      .eq(column, value)
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
    const { column, value } = workItemIdFilter(id);
    const body = await req.json();

    const updates: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (EDITABLE_FIELDS.has(k)) updates[k] = v;
    }

    // Phase 0.7: normalize sprint_number (phase). Empty / 0 / negative → null
    // ("remove from phase"); otherwise a positive decimal (phases are decimal,
    // e.g. 0.7, 1.0, 1.6 — column is numeric).
    if ("sprint_number" in updates) {
      const raw = updates.sprint_number;
      if (raw === null || raw === "" || raw === undefined) {
        updates.sprint_number = null;
      } else {
        const n = typeof raw === "number" ? raw : parseFloat(String(raw));
        updates.sprint_number = Number.isFinite(n) && n > 0 ? n : null;
      }
    }

    // phase_step is free text; trim and treat empty as null ("no sub-step").
    if ("phase_step" in updates) {
      const raw = updates.phase_step;
      const trimmed = raw == null ? "" : String(raw).trim();
      updates.phase_step = trimmed === "" ? null : trimmed;
    }

    if (typeof updates.status === "string") {
      const nowIso = new Date().toISOString();
      const { data: current } = await supabaseAdmin
        .from("work_items")
        .select("status, approved_at, prompt_ready_at, completed_at")
        .eq(column, value)
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
      .eq(column, value)
      .select()
      .single();

    if (error) throw error;

    // Auto-dispatch when caller opts in via dispatch:true AND the patch
    // assigned this item to a real agent (not brian / not unassigned).
    if (
      body.dispatch === true &&
      typeof updates.assigned_agent === "string" &&
      updates.assigned_agent &&
      updates.assigned_agent !== "brian"
    ) {
      // Fire-and-forget: don't block the PATCH response on dispatch outcome.
      // Failures are logged to work_item_logs by the dispatch route itself.
      // suppress_notify: assignment changes shouldn't ping Brian on Telegram —
      // the dashboard's existing log entry + new doc-summary entry below cover it.
      const cookieHeader = req.headers.get("cookie") ?? "";
      fetch(`${req.nextUrl.origin}/api/work/${id}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: cookieHeader },
        body: JSON.stringify({ action: "begin_work", suppress_notify: true }),
      }).catch((e) => console.error("dispatch after assign failed:", e));
    }

    // Auto-log linked documents on assignment so the assigned agent sees them
    // in their log context without Brian needing to paste URLs manually.
    if (typeof updates.assigned_agent === "string" && updates.assigned_agent) {
      const { data: linkedDocs } = await supabaseAdmin
        .from("doc_registry")
        .select("name, path, google_doc_url")
        .eq("work_item_id", id);

      if (linkedDocs && linkedDocs.length > 0) {
        const lines = linkedDocs.map((d) => {
          const drive = d.google_doc_url ? ` | Drive: ${d.google_doc_url}` : "";
          return `• ${d.name} — ${d.path}${drive}`;
        });
        await supabaseAdmin.from("work_item_logs").insert({
          work_item_id: id,
          author: "brian",
          author_type: "human",
          entry_type: "note",
          message: `Documents linked to this work item:\n${lines.join("\n")}`,
          mentions: [updates.assigned_agent],
        });
      }
    }

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
