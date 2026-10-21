import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type EventRow = { id: number; type: string; created_at: string; contact_id: string | null; version_id: string | null; deliverable_title: string | null };
type ContactRow = { id: string; name: string; email: string; first_seen_at: string };
type VersionRow = { id: string; version_no: number; deliverable: { title: string } | { title: string }[] | null };

// GET — latest room activity (opens, introductions, views) for the engagement.
// Never selects `meta` (only the single key deliverable_title) or `access_id`.
export async function GET(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const rooms = supabaseAdmin.schema("rooms");

  const { data: events, error: evErr } = await rooms.from("engagement_events")
    .select("id, type, created_at, contact_id, version_id, deliverable_title:meta->>deliverable_title")
    .eq("engagement_id", id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (evErr || !events) return NextResponse.json({ error: "Failed to load activity" }, { status: 500 });
  const rows = events as EventRow[];

  // Secondary lookups degrade to null on failure rather than failing the whole response.
  const { data: contactData, error: cErr } = await rooms.from("engagement_contacts")
    .select("id, name, email, first_seen_at").eq("engagement_id", id);
  const contacts: ContactRow[] = cErr || !contactData ? [] : (contactData as ContactRow[]).map(c => ({
    id: c.id, name: c.name, email: c.email, first_seen_at: c.first_seen_at,
  }));
  const contactById = new Map(contacts.map(c => [c.id, c]));

  const versionIds = [...new Set(rows.map(e => e.version_id).filter((v): v is string => !!v))];
  const versionById = new Map<string, { deliverable_title: string; version_no: number }>();
  if (versionIds.length > 0) {
    const { data: vData, error: vErr } = await rooms.from("deliverable_versions")
      .select("id, version_no, deliverable:deliverables(title)").in("id", versionIds);
    if (!vErr && vData) {
      for (const v of vData as unknown as VersionRow[]) {
        const d = Array.isArray(v.deliverable) ? v.deliverable[0] : v.deliverable;
        if (d) versionById.set(v.id, { deliverable_title: d.title, version_no: v.version_no });
      }
    }
  }

  return NextResponse.json({
    events: rows.map(e => {
      const c = e.contact_id ? contactById.get(e.contact_id) : undefined;
      return {
        id: e.id,
        type: e.type,
        created_at: e.created_at,
        contact: c ? { name: c.name, email: c.email } : null,
        deliverable_title: e.type === "deliverable_deleted" && typeof e.deliverable_title === "string" ? e.deliverable_title : null,
        version: (e.version_id && versionById.get(e.version_id)) || null,
      };
    }),
    contacts,
  });
}
