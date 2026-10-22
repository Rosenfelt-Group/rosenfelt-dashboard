import { NextRequest, NextResponse } from "next/server";
import { identifyCaller } from "@/lib/intake/auth";
import { CALLER_CHANNELS, IntakeSchema } from "@/lib/intake/schema";
import { intakeLead } from "@/lib/intake/client";

// Authenticated by per-caller bearer secrets (src/lib/intake/auth.ts), not by a session (excluded in middleware).

export async function POST(req: NextRequest) {
  const caller = identifyCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = IntakeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  if (!CALLER_CHANNELS[caller].includes(parsed.data.channel)) {
    return NextResponse.json({ error: "Channel not allowed for this caller" }, { status: 403 });
  }

  try {
    return NextResponse.json(await intakeLead(parsed.data));
  } catch (e) {
    console.error("intake failed", caller, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Intake failed" }, { status: 500 });
  }
}
