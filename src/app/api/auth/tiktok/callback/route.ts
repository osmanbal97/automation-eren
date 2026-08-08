import { NextRequest, NextResponse } from "next/server";
import { saveConnectionTokens } from "@/actions/platform-connections";
import { getDb } from "@/db/client";
import { OAUTH_STATE_COOKIE, OAuthStateError, verifyOAuthState } from "@/lib/oauth-state";
import { exchangeTikTokCode } from "@/lib/platforms/tiktok-oauth";

/**
 * US-021 step 2: TikTok redirects the operator back here with `code` + `state`.
 *
 * State verification comes first and fails hard as a 400 -- an unverified state is
 * a potential CSRF, so it must never reach a token exchange. Everything after that
 * point already has a trusted nicheId, so failures degrade into a redirect back to
 * the niche page with `connection_error=tiktok` rather than a raw JSON error.
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

  const failureUrl = new URL(`/niches/${nicheId}?connection_error=tiktok`, request.url);

  // TikTok omits `code` when the operator declines consent (it sends error/
  // error_description instead), which is a cancellation, not a bug.
  if (!code) {
    return NextResponse.redirect(failureUrl);
  }

  try {
    // Must byte-match the redirect_uri used on the authorize request.
    const redirectUri = new URL("/api/auth/tiktok/callback", request.url).toString();
    const tokens = await exchangeTikTokCode(code, redirectUri);
    await saveConnectionTokens(getDb(), nicheId, "tiktok", tokens);
  } catch {
    return NextResponse.redirect(failureUrl);
  }

  const response = NextResponse.redirect(new URL(`/niches/${nicheId}?connected=tiktok`, request.url));
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
