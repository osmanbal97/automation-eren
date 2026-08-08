import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionCookieValue } from "@/lib/auth";

// Paths that are never gated by the shared-password session cookie because
// they authenticate themselves a different way (cron secret header, Telegram
// webhook secret header) or are needed to reach the login page at all.
const PUBLIC_PATH_PREFIXES = ["/login", "/api/login", "/api/cron", "/api/telegram/webhook"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(SESSION_COOKIE.name)?.value;
  if (await verifySessionCookieValue(sessionCookie)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on everything except static assets / Next.js internals.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
