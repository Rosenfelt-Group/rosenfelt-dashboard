import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function PATCH(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { error } = await supabaseAdmin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("recipient", "brian");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
