import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { buildTimeline, TIMELINE_PAGE, type ActivityRow, type EmailRow } from "@/lib/crm/timeline";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/crm/contacts/:id/timeline?before=<ISO ts>&include_body=<email_message_id>
 * Newest first, 50 per page; pass the last item's ts as `before` for the next page.
 * Email bodies: each email item has a 500-char `preview`; the full `body_text` is included only for the
 * message named by include_body (keeps pages small and bodies out of lists).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid contact id" }, { status: 400 });

  const sp = req.nextUrl.searchParams;
  let before: string | null = null;
  if (sp.get("before")) {
    const t = Date.parse(sp.get("before")!);
    if (Number.isNaN(t)) return NextResponse.json({ error: "Invalid before timestamp" }, { status: 400 });
    before = new Date(t).toISOString();
  }
  const includeBody = sp.get("include_body") ?? undefined;
  if (includeBody && !UUID.test(includeBody)) return NextResponse.json({ error: "Invalid include_body" }, { status: 400 });

  const db = supabaseAdmin.schema("crm");

  const { data: leads, error: lErr } = await db.from("leads").select("id").eq("contact_id", id);
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  const leadIds = (leads ?? []).map((l) => l.id as string).filter((x) => UUID.test(x));
  const scope = [`contact_id.eq.${id}`, leadIds.length ? `lead_id.in.(${leadIds.join(",")})` : ""].filter(Boolean).join(",");

  let aq = db.from("lead_activities").select("*").or(scope);
  if (before) aq = aq.lt("created_at", before);
  const mq0 = db.from("email_messages").select("*, email_message_links!inner(contact_id)").eq("email_message_links.contact_id", id);
  const mq = before ? mq0.lt("sent_at", before) : mq0;

  const [acts, msgs] = await Promise.all([
    aq.order("created_at", { ascending: false }).limit(TIMELINE_PAGE),
    mq.order("sent_at", { ascending: false }).limit(TIMELINE_PAGE),
  ]);
  if (acts.error) return NextResponse.json({ error: acts.error.message }, { status: 500 });
  if (msgs.error) return NextResponse.json({ error: msgs.error.message }, { status: 500 });

  const emails = (msgs.data ?? []).map((m) => {
    const { email_message_links: _links, ...row } = m as Record<string, unknown>;
    return row as unknown as EmailRow;
  });
  return NextResponse.json(buildTimeline((acts.data ?? []) as ActivityRow[], emails, includeBody));
}
