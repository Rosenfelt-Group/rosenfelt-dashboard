import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { BacklogStatus } from "@/types";

const STATUSES: BacklogStatus[] = [
  "inbox",
  "approved",
  "bundled",
  "prompt_ready",
  "in_progress",
  "done",
  "rejected",
];

const PRIORITIES = ["low", "medium", "high"] as const;

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("tool_backlog")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("Backlog GET error:", err);
    return NextResponse.json([], { status: 500 });
  }
}

type PatchBody = {
  id?: number;
  ids?: number[];
  status?: BacklogStatus;
  priority?: (typeof PRIORITIES)[number] | null;
  bundle_id?: number | null;
};

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as PatchBody;
    const ids: number[] = body.ids ?? (body.id !== undefined ? [body.id] : []);
    if (ids.length === 0) {
      return NextResponse.json({ error: "No id or ids supplied" }, { status: 400 });
    }

    const update: Record<string, unknown> = {};

    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      update.status = body.status;
      if (body.status === "approved") {
        update.approved_at = new Date().toISOString();
      } else {
        // Moving out of approved clears the approved_at stamp so the item
        // reads as cleanly back-in-triage.
        update.approved_at = null;
      }
    }

    if (body.priority !== undefined) {
      if (body.priority !== null && !PRIORITIES.includes(body.priority)) {
        return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
      }
      update.priority = body.priority;
    }

    if (body.bundle_id !== undefined) {
      update.bundle_id = body.bundle_id;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("tool_backlog")
      .update(update)
      .in("id", ids)
      .select("id, status, priority, bundle_id, approved_at");
    if (error) throw error;

    return NextResponse.json({ updated: data ?? [] });
  } catch (err) {
    console.error("Backlog PATCH error:", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
