import { NextResponse, type NextRequest } from "next/server";
import {
  verifyMagicLinkToken,
  signSession,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const payload = await verifyMagicLinkToken(token);

  if (!payload) {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", "expired");
    return NextResponse.redirect(url);
  }

  const session = await signSession({ email: payload.email, isGuest: false });
  const res = NextResponse.redirect(new URL(payload.redirect || "/", req.url));
  res.cookies.set(SESSION_COOKIE_NAME, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
