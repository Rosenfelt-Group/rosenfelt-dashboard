import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { signGrant } from "@/lib/rooms/grant";
import { requirePermission } from "@/lib/requirePermission";

// GET — short-lived signed URL for previewing a version (drafts included) in the dashboard.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission(req, "view_crm");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const secret = process.env.ROOM_GRANT_SECRET;
  if (!secret) return NextResponse.json({ error: "ROOM_GRANT_SECRET is not configured" }, { status: 500 });

  const { data: v } = await supabaseAdmin.schema("rooms").from("deliverable_versions")
    .select("storage_prefix, manifest").eq("id", id).single();
  if (!v) return NextResponse.json({ error: "Version not found" }, { status: 404 });

  const entry = typeof v.manifest?.entry === "string" ? v.manifest.entry : "index.html";
  const base = (process.env.NEXT_PUBLIC_PREVIEW_URL ?? "https://preview.rosably.com").replace(/\/$/, "");
  const segs: string[] = String(entry).split("/");
  const path = segs.some((sg: string) => sg === "" || sg === "." || sg === "..")
    ? "index.html"
    : segs.map(encodeURIComponent).join("/");
  let grant: string;
  try {
    grant = signGrant(v.storage_prefix, secret);
  } catch (e) {
    return NextResponse.json({ error: `Could not sign preview grant: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
  return NextResponse.json({ url: `${base}/v/${grant}/${path}` });
}
