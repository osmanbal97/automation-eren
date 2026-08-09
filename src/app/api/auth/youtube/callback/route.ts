import { NextRequest, NextResponse } from "next/server";
import { getPlatformAppCredentials } from "@/actions/platform-apps";
import { saveConnectionTokens } from "@/actions/platform-connections";
import { getDb } from "@/db/client";
import { OAUTH_STATE_COOKIE, OAuthStateError, verifyOAuthState } from "@/lib/oauth-state";
import { exchangeYouTubeCode } from "@/lib/platforms/youtube-oauth";

/**
 * US-023 step 2: Google redirects the operator back here with `code` + `state`.
 * We verify the state/nonce pair first (a failure there is a 400, never a redirect —
 * we can't trust the nicheId in an unverified state), then exchange the code and
 * persist the encrypted tokens.
 *
 * Anything that goes wrong *after* verification is a user-facing "connection
 * failed", so it lands back on the niche page with `connection_error=youtube`
 * rather than showing a raw error body — Google's messages can include internals.
 */
export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const cookieNonce = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  let nicheId: string;
  try {
    ({ nicheId } = verifyOAuthState(state, cookieNonce));
  } catch (error) {
    if (error instanceof OAuthStateError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const failureUrl = new URL(`/niches/${nicheId}?connection_error=youtube`, request.url);

  // No code means the operator denied consent (Google sends ?error=access_denied).
  if (!code) {
    return NextResponse.redirect(failureUrl);
  }

  const db = getDb();
  const credentials = await getPlatformAppCredentials(db, "youtube");
  if (!credentials) {
    return NextResponse.redirect(
      new URL(`/niches/${nicheId}?connection_error=youtube&reason=not_configured`, request.url),
    );
  }

  try {
    const redirectUri = new URL("/api/auth/youtube/callback", request.url).toString();
    const tokens = await exchangeYouTubeCode(code, redirectUri, {
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    });
    await saveConnectionTokens(db, nicheId, "youtube", tokens);
  } catch {
    return NextResponse.redirect(failureUrl);
  }

  const response = NextResponse.redirect(
    new URL(`/niches/${nicheId}?connected=youtube`, request.url),
  );
  // The nonce is single-use; leaving it set would let a replayed callback pass.
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
