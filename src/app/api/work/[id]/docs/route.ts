import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from("doc_registry")
    .select(
      "id, name, path, description, category, google_doc_url, audience, updated_at, work_item_id",
    )
    .eq("work_item_id", id)
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ docs: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const name = String(body.name || "").trim();
  const path = String(body.path || "").trim();
  const description = body.description ? String(body.description) : null;
  const googleDocUrl = body.google_doc_url ? String(body.google_doc_url) : null;
  const audience = body.audience === "client-facing" ? "client-facing" : "internal";

  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!path) return NextResponse.json({ error: "path required" }, { status: 400 });

  // Upsert behavior: if a doc_registry row already exists at this path,
  // update it to link to this work item instead of creating a duplicate.
  const { data: existing } = await supabaseAdmin
    .from("doc_registry")
    .select("id")
    .eq("path", path)
    .maybeSingle();

  if (existing) {
    const { data: updated, error: updErr } = await supabaseAdmin
      .from("doc_registry")
      .update({ work_item_id: id })
      .eq("id", existing.id)
      .select()
      .single();
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    return NextResponse.json({ doc: updated, linked: true });
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("doc_registry")
    .insert({
      name,
      path,
      description,
      google_doc_url: googleDocUrl,
      audience,
      category: "Work Output",
      work_item_id: id,
    })
    .select()
    .single();
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  return NextResponse.json({ doc: inserted, linked: false });
}
