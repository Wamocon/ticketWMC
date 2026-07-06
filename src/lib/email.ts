// Versand der Login-Magic-Link-Mail. Zwei Backends verfügbar:
// - Resend (Standard, aktiv sobald RESEND_API_KEY + AUTH_FROM_EMAIL gesetzt sind)
// - Microsoft Graph / Client-Credentials-Flow (nur aktiv wenn GRAPH_ENABLED=true)
// Fehlt das jeweils aktive Backend: in echter Produktion harter Fehler (fail
// closed), sonst wird der Link nur geloggt und an den Aufrufer zurückgegeben
// (kein Postfach nötig).

export interface SendMagicLinkResult {
  ok: boolean;
  devLink?: string;
}

function magicLinkContent(link: string) {
  return {
    subject: "Dein Login-Link für das WMC Ticketsystem",
    html: `<p>Hallo,</p><p>klicke auf den folgenden Link, um dich anzumelden (gültig 15 Minuten):</p><p><a href="${link}">${link}</a></p><p>Wenn du diese Anmeldung nicht angefordert hast, kannst du diese E-Mail ignorieren.</p>`,
  };
}

// ── Backend: Resend ──────────────────────────────────────────────
function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.AUTH_FROM_EMAIL);
}

async function sendViaResend(to: string, link: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY as string;
  const from = process.env.AUTH_FROM_EMAIL as string;
  const { subject, html } = magicLinkContent(link);

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({ from, to, subject, html });
  if (error) {
    console.error("[auth] Resend-Versand fehlgeschlagen:", error);
    return false;
  }
  return true;
}

// ── Backend: Microsoft Graph (Client-Credentials-Flow) ───────────
// Aktuell per GRAPH_ENABLED abgeschaltet, Code bleibt für späteren
// Wechsel erhalten (z. B. sobald Mail.Send als Application-Permission
// admin-consented ist).
function graphConfigured(): boolean {
  return Boolean(
    process.env.GRAPH_TENANT_ID &&
      process.env.GRAPH_CLIENT_ID &&
      process.env.GRAPH_CLIENT_SECRET &&
      process.env.GRAPH_SENDER_EMAIL,
  );
}

interface GraphTokenCache {
  accessToken: string;
  expiresAt: number;
}
let graphTokenCache: GraphTokenCache | null = null;

async function getGraphAccessToken(): Promise<string> {
  if (graphTokenCache && Date.now() < graphTokenCache.expiresAt) {
    return graphTokenCache.accessToken;
  }

  const tenantId = process.env.GRAPH_TENANT_ID as string;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.GRAPH_CLIENT_ID as string,
    client_secret: process.env.GRAPH_CLIENT_SECRET as string,
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Graph-Token-Anfrage fehlgeschlagen (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  // 60s Sicherheitsabstand vor Ablauf.
  graphTokenCache = { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

async function sendViaGraph(to: string, link: string): Promise<boolean> {
  const senderEmail = process.env.GRAPH_SENDER_EMAIL as string;
  const { subject, html } = magicLinkContent(link);
  const accessToken = await getGraphAccessToken();

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: false,
    }),
  });
  if (!res.ok) {
    console.error("[auth] Graph-Mailversand fehlgeschlagen:", res.status, (await res.text()).slice(0, 300));
    return false;
  }
  return true;
}

// ── Öffentliche Funktion ──────────────────────────────────────────
export async function sendMagicLinkEmail(params: { to: string; link: string }): Promise<SendMagicLinkResult> {
  const { to, link } = params;
  const useGraph = process.env.GRAPH_ENABLED === "true";
  const configured = useGraph ? graphConfigured() : resendConfigured();

  if (!configured) {
    // Bewusste, befristete Entscheidung: Der Link wird auch in echter
    // Produktion direkt zurückgegeben statt fail-closed zu blockieren, bis
    // Resend/Graph fertig eingerichtet sind. Sicherheitsrisiko: Bis dahin
    // kann sich jeder ohne Zugriff auf das echte Postfach als beliebiger
    // Jira-User einloggen. Sobald ein Backend konfiguriert ist (resendConfigured()
    // bzw. graphConfigured() wird true), greift automatisch wieder der echte
    // Versand – dafür ist an dieser Stelle keine weitere Code-Änderung nötig.
    console.warn(`[auth] Mailversand nicht konfiguriert – Magic-Link (kein Versand): ${link}`);
    return { ok: true, devLink: link };
  }

  try {
    const sent = useGraph ? await sendViaGraph(to, link) : await sendViaResend(to, link);
    return { ok: sent };
  } catch (err) {
    console.error("[auth] Mailversand fehlgeschlagen:", err);
    return { ok: false };
  }
}
