import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

type PermissionCheckResult =
  | { ok: true; username: string; role: string; permissions: string[] }
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
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Invalid session" }, { status: 401 }) };
  }
  if (!session.permissions.includes(permission)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, username: session.username, role: session.role, permissions: session.permissions };
}
