import { SignJWT, jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET!);
export const COOKIE_NAME = "dashboard_session";
const SESSION_TTL = "7d";

export type Role = "admin" | "viewer";

export async function createSessionToken(username: string, role: Role): Promise<string> {
  return new SignJWT({ username, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secret);
}

export async function verifySessionToken(token: string): Promise<{ username: string; role: Role } | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return {
      username: payload.username as string,
      role: (payload.role as Role) ?? "viewer",
    };
  } catch {
    return null;
  }
}
