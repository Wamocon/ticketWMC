import { NextResponse, type NextRequest } from "next/server";
import {
  getJiraConfig,
  searchIssues,
  createIssue,
  updateIssue,
  mapIssueToTicket,
  JiraError,
  SEARCH_FIELDS,
} from "@/lib/jira";
import {
  GROUP_TO_JIRA_TYPE,
  DESCRIPTION_FIELD,
  EXTRA_FIELDS,
  isTicketGroup,
  sanitizeLabel,
  type Ticket,
  type TicketGroup,
} from "@/lib/ticketTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SUMMARY = 255;
const MAX_DESCRIPTION = 5000;
const MAX_NAME = 120;

// ── einfacher In-Memory-Rate-Limiter (bewusst ohne DB) ──────────
// Wird bei Cold-Start zurückgesetzt → Turnstile bleibt die primäre Hürde.
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(ip: string, limit = 5, windowMs = 60_000) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + windowMs });
    return { ok: true as const };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false as const, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true as const };
}

async function verifyTurnstile(token: string, ip: string) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return { ok: false, reason: "TURNSTILE_SECRET ist nicht konfiguriert" };
  if (!token) return { ok: false, reason: "Kein Captcha-Token übermittelt" };

  const form = new URLSearchParams();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);

  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const data = (await r.json().catch(() => ({}))) as {
    success?: boolean;
    "error-codes"?: string[];
  };
  return { ok: data.success === true, reason: (data["error-codes"] ?? []).join(", ") };
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function handleError(err: unknown): NextResponse {
  console.error("[api/tickets]", err);
  if (err instanceof JiraError) {
    console.error("Jira-Detail:", err.detail);
    return NextResponse.json(
      { error: "Backend-Fehler bei der Jira-Anfrage" },
      { status: err.status || 502 },
    );
  }
  return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
}

// ── GET: Liveticker ─────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { baseUrl, projectKey } = getJiraConfig();

    const typeParam = (req.nextUrl.searchParams.get("type") ?? "").toLowerCase();
    let jql = `project = "${projectKey}"`;
    if (typeParam) {
      if (!isTicketGroup(typeParam)) {
        return NextResponse.json({ error: "Unbekannter Typ-Filter" }, { status: 400 });
      }
      jql += ` AND issuetype = "${GROUP_TO_JIRA_TYPE[typeParam]}"`;
    }
    jql += " ORDER BY created DESC";

    const issues = await searchIssues({ jql, fields: SEARCH_FIELDS, maxResults: 50 });
    const tickets: Ticket[] = issues.map((i) => mapIssueToTicket(i, baseUrl));

    return NextResponse.json(
      { tickets, count: tickets.length },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return handleError(err);
  }
}

// ── POST: neuen Vorgang anlegen ─────────────────────────────────
interface TicketPayload {
  type?: string;
  summary?: string;
  description?: string;
  /** Typ-spezifische Auswahlfelder, z. B. { fehlertyp: "10195", umgebung: ["10417"] } */
  customFields?: Record<string, string | string[]>;
  /** Komponente = Jira-Stichwort */
  component?: string;
  /** System-Prioritäts-ID */
  priority?: string;
  reporterName?: string;
  reporterEmail?: string;
  turnstileToken?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { baseUrl, projectKey } = getJiraConfig();
    const ip = clientIp(req);

    const rl = rateLimit(ip);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Zu viele Anfragen. Bitte kurz warten." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      );
    }

    const body = (await req.json().catch(() => ({}))) as TicketPayload;
    const type = (body.type ?? "").toLowerCase();
    const summary = (body.summary ?? "").trim();
    const description = (body.description ?? "").trim();
    const customFields = body.customFields ?? {};
    const component = (body.component ?? "").trim();
    const priorityId = (body.priority ?? "").trim();
    const reporterName = (body.reporterName ?? "").trim();
    const reporterEmail = (body.reporterEmail ?? "").trim();
    const turnstileToken = body.turnstileToken ?? "";

    // Turnstile ist optional: nur prüfen, wenn ein Secret konfiguriert ist.
    // Ohne Secret → in Produktion abweisen (fail closed), lokal überspringen.
    if (process.env.TURNSTILE_SECRET) {
      const captcha = await verifyTurnstile(turnstileToken, ip);
      if (!captcha.ok) {
        return NextResponse.json(
          { error: "Captcha-Prüfung fehlgeschlagen", reason: captcha.reason },
          { status: 403 },
        );
      }
    } else if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Captcha ist serverseitig nicht konfiguriert" },
        { status: 403 },
      );
    } else {
      console.warn(
        "[api/tickets] TURNSTILE_SECRET fehlt – Captcha im Dev-Modus übersprungen.",
      );
    }

    if (!isTicketGroup(type)) {
      return NextResponse.json({ error: "Ungültiger Ticket-Typ" }, { status: 400 });
    }
    if (!summary) {
      return NextResponse.json({ error: "Titel ist erforderlich" }, { status: 400 });
    }
    if (summary.length > MAX_SUMMARY) {
      return NextResponse.json({ error: `Titel max. ${MAX_SUMMARY} Zeichen` }, { status: 400 });
    }
    if (description.length > MAX_DESCRIPTION) {
      return NextResponse.json(
        { error: `Beschreibung max. ${MAX_DESCRIPTION} Zeichen` },
        { status: 400 },
      );
    }

    const group = type as TicketGroup;

    // Freitext zusammenbauen (inkl. optionaler Melder-Angaben).
    let fullDescription = description;
    if (reporterName || reporterEmail) {
      const meta = [
        reporterName ? `Name: ${reporterName.slice(0, MAX_NAME)}` : null,
        reporterEmail ? `E-Mail: ${reporterEmail.slice(0, MAX_NAME)}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
      fullDescription = `${description}\n\n— Gemeldet über WMC-Ticketsystem (${meta})`;
    }

    // Jira-konforme Felder je Typ aufbauen.
    const extraFields: Record<string, unknown> = {};
    if (fullDescription) {
      extraFields[DESCRIPTION_FIELD[group]] = fullDescription;
    }
    for (const fieldDef of EXTRA_FIELDS[group]) {
      const raw = customFields[fieldDef.name];
      const values = (Array.isArray(raw) ? raw : raw ? [raw] : [])
        .map((v) => v.toString().trim())
        .filter(Boolean);

      if (values.length === 0) {
        if (fieldDef.required) {
          return NextResponse.json(
            { error: `${fieldDef.label} ist erforderlich` },
            { status: 400 },
          );
        }
        continue;
      }
      if (!values.every((v) => fieldDef.options.some((o) => o.id === v))) {
        return NextResponse.json(
          { error: `Ungültiger Wert für ${fieldDef.label}` },
          { status: 400 },
        );
      }
      extraFields[fieldDef.fieldId] = fieldDef.multiple
        ? values.map((id) => ({ id }))
        : { id: values[0] };
    }

    const created = await createIssue({
      projectKey,
      issueTypeName: GROUP_TO_JIRA_TYPE[group],
      summary,
      extraFields,
    });

    // Komponente (Stichwort) und Priorität liegen nicht auf allen Erstellen-
    // Masken → per Update nachsetzen. Schlägt das fehl, ist der Vorgang
    // trotzdem angelegt; wir melden es als Warnung.
    const updateFields: Record<string, unknown> = {};
    if (component) updateFields.labels = [sanitizeLabel(component)];
    if (priorityId) updateFields.priority = { id: priorityId };

    let warning: string | undefined;
    if (Object.keys(updateFields).length > 0) {
      try {
        await updateIssue(created.key, updateFields);
      } catch (e) {
        console.error("[api/tickets] Nachsetzen von Komponente/Priorität fehlgeschlagen:", e);
        warning = "Vorgang angelegt, aber Komponente/Priorität konnten nicht gesetzt werden.";
      }
    }

    return NextResponse.json(
      { key: created.key, jiraUrl: `${baseUrl}/browse/${created.key}`, warning },
      { status: 201 },
    );
  } catch (err) {
    return handleError(err);
  }
}
