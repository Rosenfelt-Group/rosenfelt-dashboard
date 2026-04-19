export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|manifest.json|icon-.*\\.png|login).*)",
  ],
};