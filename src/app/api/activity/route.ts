import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("workflow_logs")
      .select("id, created_at, workflow_name, agent, status, error_message, duration_ms")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("Activity error:", err);
    return NextResponse.json([], { status: 500 });
  }
}
