import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const MENTION_RE = /@(riley|jordan|avery|casey|brian)/gi;
const VALID_ENTRY_TYPES = new Set([
  "progress", "question", "answer", "note", "error", "completion",
]);

function parseMentions(message: string): string[] {
  const matches = Array.from(message.matchAll(MENTION_RE));
  return Array.from(new Set(matches.map((m) => m[1].toLowerCase())));
}

// Edit a log entry's message and/or entry_type. Scoped to this work item so a
// logId from another item can't be touched. Mentions are re-parsed to keep the
// stored array in sync, but agents are NOT re-dispatched — editing a note should
// never re-trigger agent work (that's what posting a new @mention is for).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; logId: string }> },
) {
  const { id, logId } = await params;
  const body = await req.json();

  const update: Record<string, unknown> = {};

  if (body.message !== undefined) {
    const message = String(body.message || "").trim();
    if (!message) {
      return NextResponse.json({ error: "message cannot be empty" }, { status: 400 });
    }
    update.message = message;
    update.mentions = parseMentions(message);
  }

  if (body.entry_type !== undefined) {
    const entryType = String(body.entry_type);
    if (!VALID_ENTRY_TYPES.has(entryType)) {
      return NextResponse.json({ error: `invalid entry_type: ${entryType}` }, { status: 400 });
    }
    update.entry_type = entryType;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("work_item_logs")
    .update(update)
    .eq("id", logId)
    .eq("work_item_id", id)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "log entry not found" }, { status: 404 });
  }

  return NextResponse.json({ log: data });
}
