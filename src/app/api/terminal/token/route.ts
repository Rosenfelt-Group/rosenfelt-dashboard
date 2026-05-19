import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

export async function POST(req: NextRequest) {
  const cookieToken = req.cookies.get(COOKIE_NAME)?.value;
  if (!cookieToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const session = await verifySessionToken(cookieToken);
  if (!session) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  if (session.role.toLowerCase() !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const rawSecret = process.env.DASHBOARD_JWT_SECRET;
  if (!rawSecret) {
    return NextResponse.json({ error: "Terminal not configured" }, { status: 503 });
  }

  const secret = new TextEncoder().encode(rawSecret);
  const token = await new SignJWT({ role: "ADMIN", username: session.username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("90s")
    .sign(secret);

  return NextResponse.json({ token });
}
