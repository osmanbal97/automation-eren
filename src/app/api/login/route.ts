import { NextRequest, NextResponse } from "next/server";
import { createSessionCookieValue, SESSION_COOKIE, verifyPassword } from "@/lib/auth";

export async function POST(request: NextRequest) {
  let password: string | undefined;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { password?: string } | null;
    password = body?.password;
  } else {
    const form = await request.formData();
    password = form.get("password")?.toString();
  }

  if (!password || !verifyPassword(password)) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE.name, await createSessionCookieValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE.maxAgeSeconds,
  });
  return response;
}
