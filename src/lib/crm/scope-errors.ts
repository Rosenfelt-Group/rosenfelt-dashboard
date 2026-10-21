import { NextResponse } from "next/server";

// SQLSTATEs raised by the crm scope functions (docs/migrations/2026-10-22_crm_scope_documents.sql).
const MAP: Record<string, { status: number; message: string }> = {
  SC001: { status: 409, message: "Scope changed since you loaded it" },
  SC002: { status: 409, message: "This version is no longer a pending proposal" },
  SC003: { status: 404, message: "Not found" },
  SC004: { status: 409, message: "A scope already exists" },
  SC005: { status: 400, message: "Invalid request" },
};

/** Map a Postgres/PostgREST error to a response; unknown errors are logged and returned as a generic 500. */
export function scopeErrorResponse(error: { code?: string; message?: string }, override?: Partial<Record<string, string>>) {
  const m = error.code ? MAP[error.code] : undefined;
  if (m) return NextResponse.json({ error: override?.[error.code!] ?? m.message }, { status: m.status });
  console.error("scope route error", error);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
