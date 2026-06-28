import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const maxDuration = 45;

export async function POST() {
  const averyUrl = process.env.AVERY_API_URL;
  const secret = process.env.AVERY_WEBHOOK_SECRET ?? process.env.JORDAN_WEBHOOK_SECRET;

  if (!averyUrl || !secret) {
    return NextResponse.json({ error: "Avery not configured" }, { status: 500 });
  }

  const { data: existing } = await supabaseAdmin
    .from("directories")
    .select("url");
  const knownUrls = new Set((existing ?? []).map((r: { url: string }) => r.url));

  const res = await fetch(`${averyUrl}/research-directories`, {
    method: "POST",
    headers: { "X-Webhook-Secret": secret },
  });
  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `Avery returned ${res.status}`, detail: text }, { status: 502 });
  }

  const { candidates } = await res.json() as { candidates: Record<string, unknown>[] };
  const fresh = candidates.filter(c => !knownUrls.has(c.url as string));

  if (fresh.length === 0) return NextResponse.json({ added: 0 });

  const rows = fresh.map(c => ({
    ...c,
    status: "Not Started",
    is_candidate: true,
    source: "avery_research",
  }));

  const { data, error } = await supabaseAdmin
    .from("directories")
    .insert(rows)
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ added: (data ?? []).length });
}
