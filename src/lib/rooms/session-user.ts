import { NextRequest } from "next/server";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

// Middleware already requires a valid session on every /api route; this only reads the username.
export async function sessionUsername(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  return session?.username ?? null;
}
