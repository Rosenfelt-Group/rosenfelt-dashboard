import { NextResponse } from "next/server";
import type { RileyFailKind } from "@/lib/riley/discovery";

/** Generic browser-facing response for a failed Riley call. Never includes Riley's own text. */
export function riley502(r: { kind: RileyFailKind }, message: string): NextResponse {
  if (r.kind === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (r.kind === "conflict") return NextResponse.json({ error: "The questionnaire is not in the right state for this" }, { status: 409 });
  if (r.kind === "unreachable") return NextResponse.json({ error: "Riley could not be reached. Try again in a minute." }, { status: 502 });
  return NextResponse.json({ error: message }, { status: 502 });
}
