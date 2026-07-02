import { NextResponse, type NextRequest } from "next/server";
import { searchUserByEmail, JiraError } from "@/lib/jira";
import { signMagicLinkToken } from "@/lib/auth";
import { sendMagicLinkEmail } from "@/lib/email";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const rl = rateLimit(`login:${ip}`, 5, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Zu viele Anfragen. Bitte kurz warten." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      );
    }

    const body = (await req.json().catch(() => ({}))) as { email?: string; redirect?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    const redirect = typeof body.redirect === "string" ? body.redirect : "/";

    if (!email || email.length > 200 || !EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: "Bitte eine gültige E-Mail-Adresse eingeben." },
        { status: 400 },
      );
    }

    const exists = await searchUserByEmail(email);
    if (!exists) {
      return NextResponse.json(
        { error: "Diese E-Mail-Adresse ist keinem Jira-Account zugeordnet." },
        { status: 404 },
      );
    }

    const token = await signMagicLinkToken({ email, redirect });
    const link = `${req.nextUrl.origin}/api/auth/verify?token=${encodeURIComponent(token)}`;

    const result = await sendMagicLinkEmail({ to: email, link });
    if (!result.ok) {
      return NextResponse.json(
        { error: "Login-Link konnte nicht versendet werden." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, devLink: result.devLink });
  } catch (err) {
    console.error("[api/auth/request-link]", err);
    if (err instanceof JiraError) {
      console.error("Jira-Detail:", err.detail);
      return NextResponse.json(
        { error: "Backend-Fehler bei der Jira-Anfrage" },
        { status: err.status || 502 },
      );
    }
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
