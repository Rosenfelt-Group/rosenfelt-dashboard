import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const maxDuration = 60;

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .schema("crm")
    .from("business_research")
    .select("*")
    .eq("business_id", id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json([], { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const topic = (body.topic as string | undefined)?.trim();
  if (!topic) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }

  const averyUrl = process.env.AVERY_AGENT_URL;
  const secret = process.env.AVERY_WEBHOOK_SECRET;
  if (!averyUrl || !secret) {
    return NextResponse.json({ error: "Avery not configured" }, { status: 500 });
  }

  try {
    const res = await fetch(`${averyUrl}/research/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": secret,
      },
      body: JSON.stringify({ business_id: id, topic }),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: data.detail || "Research failed" }, { status: res.status });
    }
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Research request failed" },
      { status: 500 }
    );
  }
}
