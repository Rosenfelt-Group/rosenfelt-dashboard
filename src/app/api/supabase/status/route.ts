import { NextResponse } from "next/server";
import { normalizeSupabaseStatus } from "@/lib/supabase-status";

export const maxDuration = 10;

export async function GET() {
  const res = await fetch("https://status.supabase.com/api/v2/summary.json", {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Status page unavailable" }, { status: 502 });
  }

  return NextResponse.json(normalizeSupabaseStatus(await res.json().catch(() => null)));
}
