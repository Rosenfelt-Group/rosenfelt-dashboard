import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePermission } from "@/lib/requirePermission";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  decision: z.enum(["accept", "reject"]),
  note: z.string().trim().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requirePermission(req, "manage_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "decision must be 'accept' or 'reject'" }, { status: 400 });
  const crm = supabaseAdmin.schema("crm");

  if (parsed.data.decision === "accept") {
    const { error } = await crm.rpc("accept_scope_version", { p_version_id: id });
    if (error) {
      if (/stale proposal/i.test(error.message)) return NextResponse.json({ error: "This proposal is stale: the scope changed after it was written. Reject it and ask Riley to re-propose." }, { status: 409 });
      if (/not proposed/i.test(error.message)) return NextResponse.json({ error: "This version is no longer a pending proposal" }, { status: 409 });
      if (/not found/i.test(error.message)) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const { data: v } = await crm.from("scope_versions").select("id, status, change_note").eq("id", id).maybeSingle();
  if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const line = parsed.data.note ? `Rejected: ${parsed.data.note}` : "Rejected";
  const change_note = v.change_note ? `${v.change_note}\n${line}` : line;
  const { data: rows, error } = await crm.from("scope_versions")
    .update({ status: "rejected", decided_at: new Date().toISOString(), change_note })
    .eq("id", id).eq("status", "proposed").select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) return NextResponse.json({ error: "This version is no longer a pending proposal" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
