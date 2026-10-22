import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { pageFromRows, TIMELINE_PAGE, type TimelineRow } from "@/lib/crm/timeline";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/crm/contacts/:id/timeline?before_ts=<ISO>&before_id=<uuid>
 *   -> { items: TimelineItem[], next_cursor: {before_ts, before_id} | null }, newest first, 50 per page.
 * Paging is a keyset on (ts, id) done in crm.contact_timeline (R40); pass next_cursor back as before_ts/before_id.
 * Email items carry a 500-char preview only.
 *
 * GET ...?include_body=<email_message_id>  -> { body: { email_message_id, body_text } }
 * Looks the message up by id (it must be linked to this contact) with no cursor, so it works for any message.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid contact id" }, { status: 400 });
  const sp = req.nextUrl.searchParams;
  const db = supabaseAdmin.schema("crm");

  const includeBody = sp.get("include_body");
  if (includeBody) {
    if (!UUID.test(includeBody)) return NextResponse.json({ error: "Invalid include_body" }, { status: 400 });
    const { data, error } = await db
      .from("email_messages")
      .select("id, body_text, email_message_links!inner(contact_id)")
      .eq("id", includeBody)
      .eq("email_message_links.contact_id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    return NextResponse.json({ body: { email_message_id: data.id, body_text: data.body_text ?? "" } });
  }

  let beforeTs: string | null = null;
  const beforeId = sp.get("before_id");
  if (sp.get("before_ts")) {
    const t = Date.parse(sp.get("before_ts")!);
    if (Number.isNaN(t)) return NextResponse.json({ error: "Invalid before_ts" }, { status: 400 });
    beforeTs = sp.get("before_ts")!; // keep the cursor's microseconds exactly as the database returned it
  }
  if (beforeId && !UUID.test(beforeId)) return NextResponse.json({ error: "Invalid before_id" }, { status: 400 });
  if (beforeId && !beforeTs) return NextResponse.json({ error: "before_id needs before_ts" }, { status: 400 });

  const { data, error } = await db.rpc("contact_timeline", {
    p_contact_id: id, p_before_ts: beforeTs, p_before_id: beforeId, p_limit: TIMELINE_PAGE,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(pageFromRows((data ?? []) as TimelineRow[], TIMELINE_PAGE));
}
