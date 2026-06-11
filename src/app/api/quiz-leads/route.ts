import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

export async function GET(req: NextRequest) {
  const token   = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from("assessment_leads")
    .select("id,created_at,name,email,org,org_type,snapshot,token")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json([], { status: 500 });
  return NextResponse.json(data ?? []);
}
