import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PrototypeRequestSchema } from "@/lib/rooms/schemas";
import { buildPrototypeBrief } from "@/lib/rooms/brief";

type Ctx = { params: Promise<{ id: string }> };

// POST — create the agent work item for a prototype (new deliverable or a new version).
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const parsed = PrototypeRequestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const b = parsed.data;
  const rooms = supabaseAdmin.schema("rooms");

  const { data: eng } = await rooms.from("engagements").select("*").eq("id", id).single();
  if (!eng) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  if (eng.status === "closed") return NextResponse.json({ error: "Engagement is closed" }, { status: 409 });

  const { data: biz } = await supabaseAdmin.schema("crm").from("businesses")
    .select("name, industry").eq("id", eng.business_id).single();

  // Resolve (or create) the deliverable.
  let deliverableId = b.deliverable_id;
  let deliverableTitle = b.deliverable_title ?? "";
  if (deliverableId) {
    const { data: d } = await rooms.from("deliverables")
      .select("id, title").eq("id", deliverableId).eq("engagement_id", id).single();
    if (!d) return NextResponse.json({ error: "Deliverable not found in this engagement" }, { status: 404 });
    deliverableTitle = d.title;
  } else {
    const { data: d, error } = await rooms.from("deliverables")
      .insert({ engagement_id: id, title: deliverableTitle }).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    deliverableId = d.id;
  }

  // Context for the agent: discovery answers (if any) and the latest version (if any).
  let discovery: Record<string, unknown> | null = null;
  if (eng.discovery_invite_id) {
    const { data: r } = await supabaseAdmin.schema("crm").from("discovery_responses")
      .select("answers").eq("invite_id", eng.discovery_invite_id).maybeSingle();
    discovery = (r?.answers as Record<string, unknown> | undefined) ?? null;
  }
  const { data: latest } = await rooms.from("deliverable_versions")
    .select("version_no, storage_prefix").eq("deliverable_id", deliverableId)
    .order("version_no", { ascending: false }).limit(1).maybeSingle();

  let description: string;
  try {
    description = buildPrototypeBrief({
      engagementTitle: eng.title,
      orgName: biz?.name ?? "Unknown organization",
      orgType: biz?.industry ?? null,
      relationship: eng.relationship,
      deliverableId: deliverableId!,
      deliverableTitle,
      brief: b.brief,
      discovery,
      prior: latest ? { versionNo: latest.version_no, storagePrefix: latest.storage_prefix } : null,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to build brief" }, { status: 500 });
  }

  // work_items constraints: source must be an allowed value ('manual'); a 'client' item needs client_id.
  const hasClient = Boolean(eng.client_id);
  const { data: item, error: wErr } = await supabaseAdmin.from("work_items").insert({
    title: `Prototype: ${deliverableTitle} (${biz?.name ?? "engagement"})`,
    description,
    work_type: "deliverable",
    priority: "medium",
    status: "inbox",
    assigned_agent: b.agent,
    work_item_type: hasClient ? "client" : "internal",
    client_id: hasClient ? eng.client_id : null,
    source: "manual",
    due_date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
  }).select("id").single();
  if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 });

  return NextResponse.json({ work_item_id: item.id, deliverable_id: deliverableId }, { status: 201 });
}
