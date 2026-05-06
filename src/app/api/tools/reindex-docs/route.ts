import { NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST() {
  const jordanUrl = process.env.JORDAN_API_URL;
  const secret = process.env.JORDAN_WEBHOOK_SECRET;

  if (!jordanUrl || !secret) {
    return NextResponse.json({ error: "Jordan not configured" }, { status: 500 });
  }

  const res = await fetch(`${jordanUrl}/tools/reindex-docs`, {
    method: "POST",
    headers: { "X-Webhook-Secret": secret },
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `Jordan returned ${res.status}`, detail: text }, { status: 502 });
  }

  const data = await res.json();
  return NextResponse.json(data);
}
