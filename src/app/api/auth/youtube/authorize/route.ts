import { NextRequest, NextResponse } from "next/server";
import { getPlatformAppCredentials } from "@/actions/platform-apps";
import { getDb } from "@/db/client";
import { createOAuthState, OAUTH_STATE_COOKIE } from "@/lib/oauth-state";
import { buildYouTubeAuthorizeUrl } from "@/lib/platforms/youtube-oauth";

/**
 * US-023 step 1: kicks off the Google consent flow for a niche's YouTube channel.
 * Thin by design — the URL building lives in youtube-oauth.ts so it can be unit
 * tested without Next.js.
 *
 * The random nonce inside `state` is also set as an httpOnly cookie so the callback
 * can prove the redirect came back through the same browser (double-submit, see
 * oauth-state.ts). 10 minutes is plenty for a consent screen and keeps a stale
 * cookie from lingering.
 */
export async function GET(request: NextRequest) {
  const nicheId = request.nextUrl.searchParams.get("nicheId");
  if (!nicheId) {
    return NextResponse.json({ error: "Missing nicheId" }, { status: 400 });
  }

  // Client id comes from the Socials page's configured app credentials, falling back to
  // GOOGLE_CLIENT_ID -- see getPlatformAppCredentials. Neither set means YouTube hasn't
  // been configured yet, an expected state, not a 500.
  const credentials = await getPlatformAppCredentials(getDb(), "youtube");
  if (!credentials) {
    return NextResponse.redirect(
      new URL(`/niches/${nicheId}?connection_error=youtube&reason=not_configured`, request.url),
    );
  }

  const { state, nonce } = createOAuthState(nicheId);
  // Must match the redirect_uri sent to the token endpoint in the callback exactly,
  // so both routes derive it the same way from the incoming request origin.
  const redirectUri = new URL("/api/auth/youtube/callback", request.url).toString();

  const response = NextResponse.redirect(
    buildYouTubeAuthorizeUrl(state, redirectUri, { clientId: credentials.clientId }),
  );
  response.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}
