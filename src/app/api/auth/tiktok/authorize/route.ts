import { NextRequest, NextResponse } from "next/server";
import { createOAuthState, OAUTH_STATE_COOKIE } from "@/lib/oauth-state";
import { buildTikTokAuthorizeUrl } from "@/lib/platforms/tiktok-oauth";

/**
 * US-021 step 1: kicks off TikTok's Login Kit consent flow for one niche.
 *
 * The niche being connected is carried through TikTok in the signed-ish `state`
 * param, with its nonce mirrored into an httpOnly cookie so the callback can
 * confirm the redirect came back through the same browser (see oauth-state.ts).
 */
export async function GET(request: NextRequest) {
  const nicheId = request.nextUrl.searchParams.get("nicheId");
  if (!nicheId) {
    return NextResponse.json({ error: "Missing nicheId" }, { status: 400 });
  }

  const { state, nonce } = createOAuthState(nicheId);
  // Built from request.url so preview deployments and localhost each get their own
  // absolute callback -- it must byte-match the redirect_uri sent at exchange time.
  const redirectUri = new URL("/api/auth/tiktok/callback", request.url).toString();

  const response = NextResponse.redirect(buildTikTokAuthorizeUrl(state, redirectUri));
  response.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // The consent screen is a one-shot interaction; ten minutes is plenty and
    // keeps a stale nonce from lingering.
    maxAge: 600,
  });
  return response;
}
