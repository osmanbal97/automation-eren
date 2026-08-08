import { NextRequest, NextResponse } from "next/server";
import { saveConnectionTokens } from "@/actions/platform-connections";
import { getDb } from "@/db/client";
import { OAUTH_STATE_COOKIE, OAuthStateError, verifyOAuthState } from "@/lib/oauth-state";
import { exchangeInstagramCode } from "@/lib/platforms/instagram-oauth";

/**
 * US-022 step 2: Meta redirects back here with `code` + `state`.
 *
 * State/nonce mismatches are the only thing answered with a JSON 400 — at that
 * point we do not trust the request enough to know which niche to bounce the
 * operator back to. Every later failure (user denied, exchange failed, no
 * linked IG business account) redirects to the niche page with
 * `connection_error=instagram` so the UI can show a retry.
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

  const failureUrl = new URL(`/niches/${nicheId}?connection_error=instagram`, request.url);

  // No code means the operator denied the Facebook Login dialog (or Meta sent
  // back an `error` param instead).
  if (!code) {
    return NextResponse.redirect(failureUrl);
  }

  // Must match the redirect_uri sent to the authorize dialog exactly, or Meta
  // rejects the code exchange.
  const redirectUri = new URL("/api/auth/instagram/callback", request.url).toString();

  try {
    const tokens = await exchangeInstagramCode(code, redirectUri);
    const db = getDb();
    await saveConnectionTokens(db, nicheId, "instagram", tokens);
  } catch {
    return NextResponse.redirect(failureUrl);
  }

  const response = NextResponse.redirect(
    new URL(`/niches/${nicheId}?connected=instagram`, request.url),
  );
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}
