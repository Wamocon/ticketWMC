// Versand der Login-Magic-Link-Mail über Resend.
// Fehlt RESEND_API_KEY: in echter Produktion harter Fehler (fail closed), sonst
// wird der Link nur geloggt und an den Aufrufer zurückgegeben (kein Postfach nötig).

import { isRealProduction } from "@/lib/env";

export interface SendMagicLinkResult {
  ok: boolean;
  devLink?: string;
}

export async function sendMagicLinkEmail(params: { to: string; link: string }): Promise<SendMagicLinkResult> {
  const { to, link } = params;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_FROM_EMAIL;

  if (!apiKey) {
    if (isRealProduction()) {
      console.error("[auth] RESEND_API_KEY fehlt – Magic-Link-Versand in Produktion nicht möglich.");
      return { ok: false };
    }
    console.warn(`[auth] RESEND_API_KEY fehlt – Magic-Link (Dev-Modus, kein Versand): ${link}`);
    return { ok: true, devLink: link };
  }
  if (!from) {
    console.error("[auth] AUTH_FROM_EMAIL ist nicht konfiguriert.");
    return { ok: false };
  }

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to,
    subject: "Dein Login-Link für das WMC Ticketsystem",
    html: `<p>Hallo,</p><p>klicke auf den folgenden Link, um dich anzumelden (gültig 15 Minuten):</p><p><a href="${link}">${link}</a></p><p>Wenn du diese Anmeldung nicht angefordert hast, kannst du diese E-Mail ignorieren.</p>`,
  });
  if (error) {
    console.error("[auth] Resend-Versand fehlgeschlagen:", error);
    return { ok: false };
  }
  return { ok: true };
}
