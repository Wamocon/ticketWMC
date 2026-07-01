# WMC Ticketsystem

Ein einfaches Ticketsystem mit **Jira Cloud als Backend** – **ohne eigene Datenbank**.
Nutzer melden drei Arten von Vorgängen (Produktidee, Optimierung, Fehler/Problem),
ein **Liveticker-Dashboard** zeigt alle Vorgänge des Projekts und aktualisiert sich automatisch.

## Tech-Stack

Identisch zum Haus-Template (`template_repo`):

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4**, **Geist**-Fonts
- Der Jira-Proxy läuft als **Next.js Route Handler** (`src/app/api/tickets/route.ts`) –
  serverseitig, gleiche Domain wie das Frontend → **kein CORS, kein separates Backend**.

> **Lokaler Start braucht kein Vercel.** `npm run dev` startet alles (Frontend *und* die
> API-Route) auf deinem Rechner unter `http://localhost:3000`.

## Warum überhaupt eine Server-Route (statt reinem HTML)?

1. **CORS** – Jira Cloud sendet bewusst keine CORS-Header; direkte Browser-Aufrufe sind geblockt.
2. **Credential-Schutz** – ein API-Token in statischem HTML wäre öffentlich. Es gehört serverseitig.

Die Route Handler lösen beides: Token bleibt in den Env-Variablen, gleiche Domain → kein CORS.

## Projektstruktur

```
src/
├── app/
│   ├── layout.tsx              # Geist-Fonts, Header, Footer
│   ├── globals.css             # Tailwind v4
│   ├── page.tsx                # Liveticker-Dashboard (Polling alle 30 s)
│   ├── neu/page.tsx            # Formular „Ticket anlegen" + Turnstile
│   └── api/tickets/route.ts    # Proxy: GET (Suche) + POST (anlegen)
├── components/
│   ├── SiteHeader.tsx
│   └── TicketCard.tsx
└── lib/
    ├── jira.ts                 # Jira-Auth, fetch-Wrapper, Sanitizing
    ├── ticketTypes.ts          # Typ-Mapping (idee/optimierung/fehler ↔ Jira)
    └── relativeTime.ts
```

## Vorgangstyp-Zuordnung

In `src/lib/ticketTypes.ts` bereits auf das Projekt **WIDEA** gesetzt:

| App-Typ | Jira-Vorgangstyp |
|---|---|
| Produktidee | `Produkt` |
| Optimierung | `Vorgehen` |
| Fehler / Problem | `Bug` |

### Felder pro Typ

- **Alle Typen:** Titel, Beschreibung, **Komponente** (= Jira-Stichwort, bestehende per
  Combobox wählbar oder neu eingeben), **Priorität** (Jira-System-Priorität).
- **Nur Fehler:** **Fehlertyp** + **Fehlerklasse** (Pflicht) sowie **Umgebung** (Mehrfachauswahl).

Beschreibung wird je Typ ins richtige Jira-Feld geschrieben (`description` beim Bug,
`Problembeschreibung`/`customfield_10776` bei Produkt/Vorgehen). Komponente (`labels`) und
Priorität liegen nicht auf allen Erstellen-Masken und werden daher per **Create-then-Update**
nachgesetzt (siehe `src/lib/jira.ts` → `updateIssue`). Feld-IDs/Optionen: `src/lib/ticketTypes.ts`.

### Übersicht / Struktur

Pro Spalte stehen **offene** Vorgänge oben, nach Dringlichkeit sortiert und farblich abgestuft
(Kritisch → Niedrig; gespeist aus Priorität bzw. Fehlerklasse). **Erledigte** sind darunter
gruppiert und kompakt dargestellt. Zusätzlich: Filter nach Komponente und Umschalter für
Erledigte. Auswahldaten (Stichwörter/Prioritäten) liefert `GET /api/meta`.

## Umgebungsvariablen (`.env.local`)

| Variable | Wert |
|---|---|
| `JIRA_BASE_URL` | `https://wamocon.atlassian.net` |
| `JIRA_EMAIL` | E-Mail des Token-Inhabers |
| `JIRA_API_TOKEN` | API-Token ([id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens)) |
| `JIRA_PROJECT_KEY` | `WIDEA` |
| `TURNSTILE_SECRET` | Turnstile Secret (Server) |
| `NEXT_PUBLIC_TURNSTILE_SITEKEY` | Turnstile Sitekey (Client, öffentlich) |

**Turnstile ist optional.** Lass lokal einfach **beide** Variablen weg/leer –
dann läuft das Ganze ohne Captcha: Das Formular blendet das Widget aus und der Server
überspringt die Prüfung (nur im Dev-Modus; in Produktion ohne Secret → 403, fail-closed).

Alternativ mit den Cloudflare-Testkeys testen (laufen immer durch):

```
TURNSTILE_SECRET=1x0000000000000000000000000000000AA
NEXT_PUBLIC_TURNSTILE_SITEKEY=1x00000000000000000000AA
```

> Hinweis: Entweder **beide** setzen oder **beide** weglassen – sonst sendet das Formular
> keinen Token, während der Server einen erwartet (→ 403).

## Lokal entwickeln

```bash
npm install
npm run dev        # http://localhost:3000  (kein Vercel nötig)
```

Prüfen vor dem Commit:

```bash
npm run verify     # typecheck + lint + build
```

## Deploy (Produktion)

Beliebiger Next.js-Host (z. B. Vercel). Bei Vercel:

1. Repo zu GitHub pushen, in Vercel importieren (Framework wird als Next.js erkannt).
2. Unter **Settings → Environment Variables** alle Variablen aus der Tabelle setzen –
   inkl. der **echten** Turnstile-Keys (siehe unten).
3. Deploy.

### Echte Turnstile-Keys (kostenlos)

[dash.cloudflare.com](https://dash.cloudflare.com/) → **Turnstile** → Widget hinzufügen
(Hostnames = `localhost` + eure Deploy-Domain) → liefert **Sitekey** (öffentlich) und
**Secret** (geheim). Turnstile ist unbegrenzt kostenlos.

## Sicherheit

- **Token nur serverseitig** – erscheint nie im ausgelieferten Frontend.
- **Cloudflare Turnstile** schützt den Schreib-Endpoint (serverseitig verifiziert).
- **Eingabe-Härtung:** Längenlimits, `issuetype` nur aus fester Whitelist.
- **Rate-Limiting** pro IP im Route Handler (ohne DB; primäre Hürde = Turnstile).
- **Security-Header** (CSP, X-Content-Type-Options, …) in `next.config.ts`.

## Rate-Limits (Jira Cloud)

~65.000 Punkte/Stunde pro Site. Suche mit ~50 Treffern ≈ 51 Punkte; Polling alle 30 s
≈ 6.000 Punkte/h – komfortabel im Budget. Die Felder-Whitelist (`SEARCH_FIELDS` in
`src/lib/jira.ts`) hält die Kosten niedrig; `429` wird mit `Retry-After` abgefangen.
