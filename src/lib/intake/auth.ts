import type { NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { CALLER_SECRET_ENV } from "@/lib/intake/schema";

// Per-caller bearer secrets for the /api/intake/* routes (no session; excluded in middleware).
// A caller whose secret env var is unset or empty is disabled (fail closed).

const digest = (s: string) => createHash("sha256").update(s).digest();

export function identifyCaller(req: NextRequest): string | null {
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
