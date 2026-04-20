import { auth } from "@/auth";
import { NextRequest } from "next/server";

export default auth((req: NextRequest & { auth: unknown }) => {
  const isAuth = !!req.auth;
  const isLoginPage = req.nextUrl.pathname.startsWith("/login");

  if (isLoginPage && isAuth) {
    return Response.redirect(new URL("/overview", req.nextUrl));
  }

  if (!isLoginPage && !isAuth) {
    return Response.redirect(new URL("/login", req.nextUrl));
  }
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|manifest.json|icon-.*\\.png).*)" ],
};