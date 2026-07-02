import { NextResponse, type NextRequest } from "next/server";
import { verifySessionCookie, SESSION_COOKIE_NAME } from "@/lib/auth";

// Schützt die gesamte App (Liveticker + Formular + APIs). Ausnahmen: /login,
// /api/auth/* (sonst könnte man sich nicht einloggen) und Next-interne Pfade.
export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};

export async function proxy(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = cookie ? await verifySessionCookie(cookie) : null;

  if (session) return NextResponse.next();

  // APIs bekommen eine JSON-401-Antwort statt eines HTML-Redirects.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }

  const url = new URL("/login", req.url);
  url.searchParams.set("redirect", req.nextUrl.pathname + req.nextUrl.search);
  const res = NextResponse.redirect(url);
  if (cookie) res.cookies.delete(SESSION_COOKIE_NAME);
  return res;
}
