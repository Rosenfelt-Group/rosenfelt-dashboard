import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";
import { parseTrashTarget } from "@/lib/crm/trash";
import { softDelete } from "@/lib/crm/trash-server";
import { parseNextStep } from "@/lib/crm/next-step";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("leads")
    .select("*, business:businesses(*), contact:contacts(*)")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const nextStep = parseNextStep(body);
  if (!nextStep.ok) return NextResponse.json({ error: nextStep.error }, { status: 400 });
  // stage_entered_at is kept by a trigger (docs/migrations/2026-10-25_d_leads_next_step.sql).
  const rest: Record<string, unknown> = { ...body };
  delete rest.stage_entered_at;
  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("leads")
    .update({ ...rest, ...nextStep.patch })
    .eq("id", id)
    .select("*, business:businesses(*), contact:contacts(*)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  // Soft delete: the deal and its discovery invites go to Trash (restorable for 30 days).
  const { id } = await params;
  const parsed = parseTrashTarget({ kind: "lead", id });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const res = await softDelete("lead", parsed.value.id, guard.username);
  return res.ok ? new NextResponse(null, { status: 204 }) : res;
}
