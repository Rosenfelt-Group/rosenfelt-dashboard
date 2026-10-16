import { NextRequest, NextResponse } from "next/server";
import { finalizeSend } from "@/lib/discovery/send";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/crm/discovery/:id/send — freeze the draft's questionnaire and mark it sent.
export async function POST(_: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const result = await finalizeSend(id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, link: result.link });
}
