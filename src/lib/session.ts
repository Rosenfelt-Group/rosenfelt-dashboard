import { SignJWT, jwtVerify } from "jose";
import { DEFAULT_PERMISSIONS } from "@/lib/permissions";

const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET!);
export const COOKIE_NAME = "dashboard_session";
const SESSION_TTL = "7d";

// Role is now an open string to support custom role names.
export type Role = string;

export async function createSessionToken(
  username: string,
  role: Role,
  permissions: string[],
): Promise<string> {
  return new SignJWT({ username, role, permissions })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secret);
}

export async function verifySessionToken(
  token: string,
): Promise<{ username: string; role: Role; permissions: string[] } | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    const role = (payload.role as Role) ?? "viewer";
    // Fall back to default permissions for old JWTs that predate RBAC v2.
    const permissions =
      Array.isArray(payload.permissions) && payload.permissions.length > 0
        ? (payload.permissions as string[])
        : (DEFAULT_PERMISSIONS[role] ?? []);
    return { username: payload.username as string, role, permissions };
  } catch {
    return null;
  }
}
