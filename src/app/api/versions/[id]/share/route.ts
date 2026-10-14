import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST — publish a draft to the room. Atomic: the previously shared version of the deliverable becomes superseded.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid version id." }, { status: 400 });
  const { data, error } = await supabaseAdmin.schema("rooms").rpc("share_version", { p_version: id });
  if (error) {
    if (error.code === "P0001") return NextResponse.json({ error: "Only a draft can be shared." }, { status: 409 });
    if (error.code === "P0002") return NextResponse.json({ error: "Version not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not share this version." }, { status: 500 });
  }
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json(row ?? {});
}
