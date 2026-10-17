import { NextRequest, NextResponse } from "next/server";
import { RefreshAccessSchema } from "@/lib/rooms/schemas";
import { refreshAccess } from "@/lib/rooms/refresh-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string; accessId: string }> };

// POST — revoke this link and issue its replacement in one database transaction (rooms.refresh_access).
// The new raw token is returned exactly once; only its hash reaches the database; it is never logged.
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id, accessId } = await params;
  if (!UUID.test(id) || !UUID.test(accessId)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const parsed = RefreshAccessSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const r = await refreshAccess(id, accessId, parsed.data.expires_days);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ id: r.accessId, link: r.link, expires_at: r.expiresAt }, { status: 201 });
}
