import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { CALLER_CHANNELS, CALLER_SECRET_ENV, IntakeSchema } from "@/lib/intake/schema";
import { intakeLead } from "@/lib/intake/client";

// Authenticated by per-caller bearer secrets, not by a session (excluded in middleware).
// A caller whose secret env var is unset or empty is disabled (fail closed).

const digest = (s: string) => createHash("sha256").update(s).digest();

function identifyCaller(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(header);
  if (!m) return null;
  const presented = digest(m[1]);
  let found: string | null = null;
  // No early exit: every configured secret is compared.
  for (const [caller, envName] of Object.entries(CALLER_SECRET_ENV)) {
    const secret = process.env[envName];
    if (!secret) continue;
    if (timingSafeEqual(presented, digest(secret))) found = caller;
  }
  return found;
}

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
