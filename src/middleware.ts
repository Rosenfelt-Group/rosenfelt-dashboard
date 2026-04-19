import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const token = await getToken({ req: request });
  const isAuth = !!token;
  const isAuthPage = request.nextUrl.pathname.startsWith("/login");

  if (isAuthPage) {
    if (isAuth) {
      return NextResponse.redirect(new URL("/overview", request.url));
    }
    return null;
  }

  if (!isAuth) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|manifest.json|icon-.*\\.png).*)"],
};