import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { TIMELINE_PAGE } from "@/lib/crm/timeline";
import { orgPageFromRows, type OrgTimelineRow } from "@/lib/crm/org-timeline";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/crm/organizations/:id/timeline?before_ts=<ISO>&before_id=<uuid>
 *   -> { items: OrgTimelineItem[], next_cursor }, newest first, 50 per page (crm.org_timeline).
 * Emails, lead activities, room events and scope versions for everyone and everything at the organization.
 *
 * GET ...?include_body=<email_message_id> -> { body: { email_message_id, body_text } }
 * The message must be linked to a current contact at this organization.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  const sp = req.nextUrl.searchParams;
  const db = supabaseAdmin.schema("crm");

  const includeBody = sp.get("include_body");
  if (includeBody) {
    if (!UUID.test(includeBody)) return NextResponse.json({ error: "Invalid include_body" }, { status: 400 });
    const { data, error } = await db
      .from("email_messages")
      .select("id, body_text, email_message_links!inner(contact_id, contacts!inner(business_id, deleted_at))")
      .eq("id", includeBody)
      .eq("email_message_links.contacts.business_id", id)
      .is("email_message_links.contacts.deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    return NextResponse.json({ body: { email_message_id: data.id, body_text: data.body_text ?? "" } });
  }

  let beforeTs: string | null = null;
  const beforeId = sp.get("before_id");
  if (sp.get("before_ts")) {
    if (Number.isNaN(Date.parse(sp.get("before_ts")!))) return NextResponse.json({ error: "Invalid before_ts" }, { status: 400 });
    beforeTs = sp.get("before_ts")!; // keep the cursor's microseconds exactly as the database returned it
  }
  if (beforeId && !UUID.test(beforeId)) return NextResponse.json({ error: "Invalid before_id" }, { status: 400 });
  if (beforeId && !beforeTs) return NextResponse.json({ error: "before_id needs before_ts" }, { status: 400 });

  const { data, error } = await db.rpc("org_timeline", {
    p_business_id: id, p_before_ts: beforeTs, p_before_id: beforeId, p_limit: TIMELINE_PAGE,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(orgPageFromRows((data ?? []) as OrgTimelineRow[], TIMELINE_PAGE));
}
