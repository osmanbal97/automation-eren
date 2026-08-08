import { NextRequest, NextResponse } from "next/server";
import { createOAuthState, OAUTH_STATE_COOKIE } from "@/lib/oauth-state";
import { buildInstagramAuthorizeUrl } from "@/lib/platforms/instagram-oauth";

/**
 * US-022 step 1: kicks off the Instagram (Meta) connect flow for one niche.
 *
 * Stays a thin wrapper — the URL building lives in instagram-oauth.ts so it can
 * be unit-tested without Next.js. The random nonce inside `state` is mirrored
 * into an httpOnly cookie so the callback can prove the redirect came back
 * through the same browser (see oauth-state.ts).
 */
export async function GET(request: NextRequest) {
  const nicheId = request.nextUrl.searchParams.get("nicheId");

  if (!nicheId) {
    return NextResponse.json({ error: "Missing nicheId" }, { status: 400 });
  }

  const { state, nonce } = createOAuthState(nicheId);
  const redirectUri = new URL("/api/auth/instagram/callback", request.url).toString();
  const authorizeUrl = buildInstagramAuthorizeUrl(state, redirectUri);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // 10 minutes: long enough to finish the Facebook Login dialog, short enough
    // that an abandoned flow leaves nothing usable behind.
    maxAge: 600,
  });
  return response;
}
