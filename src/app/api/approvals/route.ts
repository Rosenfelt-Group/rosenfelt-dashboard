import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const history = searchParams.get("history") === "true";

    const query = supabaseAdmin
      .from("pending_approvals")
      .select("*")
      .order("created_at", { ascending: false });

    if (!history) query.eq("status", "pending");

    const { data, error } = await query.limit(200);
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("Approvals error:", err);
    return NextResponse.json([], { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, status } = await req.json();
    if (!id || !["approved", "rejected"].includes(status)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("pending_approvals")
      .update({ status })
      .eq("id", id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Approval update error:", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
