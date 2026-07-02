import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { signSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = rateLimit(`guest:${ip}`, 5, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Zu viele Anfragen. Bitte kurz warten." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const guestEmail = process.env.GUEST_EMAIL ?? "";
  const guestCode = process.env.GUEST_ACCESS_CODE ?? "";
  if (!guestEmail || !guestCode) {
    return NextResponse.json(
      { error: "Gastzugang ist serverseitig nicht konfiguriert." },
      { status: 500 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { code?: string };
  const code = (body.code ?? "").trim();

  if (!code || !safeEqual(code, guestCode)) {
    return NextResponse.json({ error: "Zugangscode ist ungültig." }, { status: 401 });
  }

  const session = await signSession({ email: guestEmail, isGuest: true });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
