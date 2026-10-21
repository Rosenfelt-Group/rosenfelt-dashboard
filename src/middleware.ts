import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

// Pages that require a specific permission to access.
// Users without the permission are redirected to /overview.
// (Empty since 2026-10-17: the old /users, /rbac and /chat pages became tabs
// under /tools and /agents/[name], which hide them by permission, and their
// APIs enforce access server-side.)
const PROTECTED_PAGES: Record<string, string> = {};

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const path = request.nextUrl.pathname;
  const requiredPermission = Object.entries(PROTECTED_PAGES).find(
    ([p]) => path === p || path.startsWith(p + "/"),
  )?.[1];

  if (requiredPermission && !session.permissions.includes(requiredPermission)) {
    return NextResponse.redirect(new URL("/overview", request.url));
  }

  const response = NextResponse.next();
  response.headers.set("x-user-role", session.role);
  response.headers.set("x-user-name", session.username);
  response.headers.set("x-user-permissions", JSON.stringify(session.permissions));
  return response;
}

export const config = {
  matcher: [
    "/((?!login|api/auth/login|api/auth/logout|api/github/webhook|api/vps/deploy|api/stripe/webhook|api/intake(?:/|$)|api/email/gmail-push(?:/|$)|api/cron/gmail-watch(?:/|$)|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
