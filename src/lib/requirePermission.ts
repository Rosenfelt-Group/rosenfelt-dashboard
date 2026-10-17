import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";

type PermissionCheckResult =
  | { ok: true; username: string; role: string }
  | { ok: false; response: NextResponse };

export async function requirePermission(
  req: NextRequest,
  permission: string,
): Promise<PermissionCheckResult> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  const session = await verifySessionToken(token);
  // Role "admin" passes every check (see hasPermission), so admins aren't locked
  // out of permissions added after their session was issued.
  if (!session || !hasPermission(session, permission)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, username: session.username, role: session.role };
}
