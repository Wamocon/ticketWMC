// Server-seitiger Zugriff auf die Jira-Cloud-REST-API.
// Das API-Token verlässt nie den Server (läuft nur im Route Handler).

import {
  JIRA_TYPE_TO_GROUP,
  FIELD_FEHLERTYP,
  FIELD_FEHLERKLASSE,
  FIELD_UMGEBUNG,
  type Ticket,
  type SelectOption,
} from "@/lib/ticketTypes";

export interface JiraConfig {
  baseUrl: string;
  email: string;
  token: string;
  projectKey: string;
}

export class JiraError extends Error {
  status: number;
  detail: string;
  constructor(message: string, status: number, detail = "") {
    super(message);
    this.name = "JiraError";
    this.status = status;
    this.detail = detail;
  }
}

/** Liest die Jira-Konfiguration aus den Umgebungsvariablen. */
export function getJiraConfig(): JiraConfig {
  const baseUrl = (process.env.JIRA_BASE_URL ?? "").replace(/\/+$/, "");
  const email = process.env.JIRA_EMAIL ?? "";
  const token = process.env.JIRA_API_TOKEN ?? "";
  const projectKey = process.env.JIRA_PROJECT_KEY ?? "";

  const missing: string[] = [];
  if (!baseUrl) missing.push("JIRA_BASE_URL");
  if (!email) missing.push("JIRA_EMAIL");
  if (!token) missing.push("JIRA_API_TOKEN");
  if (!projectKey) missing.push("JIRA_PROJECT_KEY");
  if (missing.length) {
    throw new JiraError(`Fehlende Umgebungsvariablen: ${missing.join(", ")}`, 500);
  }
  return { baseUrl, email, token, projectKey };
}

function authHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}

interface JiraFetchOptions {
  method?: string;
  body?: unknown;
  retry?: boolean;
}

/** Dünner fetch-Wrapper; behandelt 429 mit einem Retry (Retry-After). */
async function jiraFetch(path: string, options: JiraFetchOptions = {}): Promise<Response> {
  const { method = "GET", body, retry = true } = options;
  const { baseUrl, email, token } = getJiraConfig();

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: authHeader(email, token),
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (res.status === 429 && retry) {
    const retryAfter = Number(res.headers.get("Retry-After")) || 2;
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 10) * 1000));
    return jiraFetch(path, { method, body, retry: false });
  }
  return res;
}

// ── Minimale Typen der von uns genutzten Jira-Felder ────────────
interface JiraOption {
  id?: string;
  value?: string;
  name?: string;
}
interface JiraIssue {
  key: string;
  fields?: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    issuetype?: { name?: string };
    priority?: { name?: string } | null;
    labels?: string[];
    components?: Array<{ id?: string; name?: string }>;
    assignee?: { displayName?: string } | null;
    reporter?: { displayName?: string } | null;
    created?: string;
    updated?: string;
    // Projektspezifische Custom-Fields (dynamische Schlüssel)
    [key: string]: unknown;
  };
}

function optionValue(v: unknown): string | null {
  if (v && typeof v === "object" && "value" in v) {
    const val = (v as JiraOption).value;
    return val ? String(val) : null;
  }
  return null;
}
function optionArrayValues(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(optionValue).filter((x): x is string => Boolean(x));
}

interface SearchResponse {
  issues?: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}

interface CreatedIssue {
  id: string;
  key: string;
  self: string;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

/** Sucht Vorgänge per JQL (aktueller Endpoint POST /rest/api/3/search/jql). */
export async function searchIssues(params: {
  jql: string;
  fields: string[];
  maxResults?: number;
}): Promise<JiraIssue[]> {
  const { jql, fields, maxResults = 50 } = params;
  const res = await jiraFetch("/rest/api/3/search/jql", {
    method: "POST",
    body: { jql, maxResults, fields },
  });
  if (!res.ok) {
    throw new JiraError(`Jira-Suche fehlgeschlagen (${res.status})`, res.status, await safeText(res));
  }
  const data = (await res.json()) as SearchResponse;
  return data.issues ?? [];
}

/**
 * Legt einen Vorgang an (POST /rest/api/2/issue).
 * `extraFields` enthält bereits Jira-konform aufgebaute Felder (z. B.
 * { description: "...", customfield_10490: { id: "10195" } }).
 * v2 akzeptiert Plain-Text für Text-/Rich-Text-Felder (kein ADF nötig).
 */
export async function createIssue(params: {
  projectKey: string;
  issueTypeName: string;
  summary: string;
  extraFields?: Record<string, unknown>;
}): Promise<CreatedIssue> {
  const { projectKey, issueTypeName, summary, extraFields = {} } = params;
  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    summary,
    issuetype: { name: issueTypeName },
    ...extraFields,
  };

  const res = await jiraFetch("/rest/api/2/issue", { method: "POST", body: { fields } });
  if (!res.ok) {
    throw new JiraError(`Vorgang anlegen fehlgeschlagen (${res.status})`, res.status, await safeText(res));
  }
  return (await res.json()) as CreatedIssue;
}

/**
 * Hängt eine Datei an einen bestehenden Vorgang an (POST .../attachments).
 * Nutzt bewusst kein jiraFetch(), da dieses den Body immer als JSON sendet –
 * Jiras Attachment-Endpoint erwartet multipart/form-data und den Header
 * `X-Atlassian-Token: no-check` (CSRF-Ausnahme für diesen Endpunkt).
 */
export async function addAttachment(issueKey: string, file: File): Promise<void> {
  const { baseUrl, email, token } = getJiraConfig();
  const form = new FormData();
  form.append("file", file, file.name);

  const res = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`, {
    method: "POST",
    headers: {
      Authorization: authHeader(email, token),
      "X-Atlassian-Token": "no-check",
      Accept: "application/json",
    },
    body: form,
  });
  if (!res.ok) {
    throw new JiraError(
      `Anhang "${file.name}" hochladen fehlgeschlagen (${res.status})`,
      res.status,
      await safeText(res),
    );
  }
}

/** Reduziert einen rohen Jira-Vorgang auf die fürs Frontend nötigen Felder. */
export function mapIssueToTicket(issue: JiraIssue, baseUrl: string): Ticket {
  const f = issue.fields ?? {};
  const type = f.issuetype?.name ?? "";
  return {
    key: issue.key,
    summary: f.summary ?? "",
    type,
    group: JIRA_TYPE_TO_GROUP[type] ?? "sonstige",
    status: f.status?.name ?? "",
    statusCategory: f.status?.statusCategory?.key ?? "",
    priority: f.priority?.name ?? null,
    components: Array.isArray(f.components)
      ? f.components.map((c) => c.name).filter((n): n is string => Boolean(n))
      : [],
    labels: Array.isArray(f.labels) ? f.labels : [],
    fehlertyp: optionValue(f[FIELD_FEHLERTYP]),
    fehlerklasse: optionValue(f[FIELD_FEHLERKLASSE]),
    umgebung: optionArrayValues(f[FIELD_UMGEBUNG]),
    assignee: f.assignee?.displayName ?? null,
    reporter: f.reporter?.displayName ?? null,
    created: f.created ?? null,
    updated: f.updated ?? null,
    jiraUrl: `${baseUrl}/browse/${issue.key}`,
  };
}

/** Felder, die der Liveticker anfordert (Whitelist spart Rate-Limit-Punkte). */
export const SEARCH_FIELDS = [
  "summary",
  "status",
  "issuetype",
  "priority",
  "labels",
  "components",
  "created",
  "updated",
  "assignee",
  "reporter",
  FIELD_FEHLERTYP,
  FIELD_FEHLERKLASSE,
  FIELD_UMGEBUNG,
];

/**
 * Aktualisiert Felder eines bestehenden Vorgangs (PUT /rest/api/2/issue/{key}).
 * Wird für Felder genutzt, die nicht auf der Erstellen-Maske liegen
 * (z. B. labels/Komponente und priority).
 */
export async function updateIssue(key: string, fields: Record<string, unknown>): Promise<void> {
  if (Object.keys(fields).length === 0) return;
  const res = await jiraFetch(`/rest/api/2/issue/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: { fields },
  });
  if (!res.ok) {
    throw new JiraError(`Vorgang aktualisieren fehlgeschlagen (${res.status})`, res.status, await safeText(res));
  }
}

// ── Meta: bestehende Stichwörter, Prioritäten und Komponenten (mit kurzem Cache) ──
let labelCache: { values: string[]; at: number } | null = null;
let priorityCache: { values: SelectOption[]; at: number } | null = null;
// Pro Projekt-Key gecacht, da Komponenten projektgebunden sind (z. B. WIDEA
// und CATI haben unterschiedliche Komponentenlisten).
const componentCache = new Map<string, { values: SelectOption[]; at: number }>();
let projectCache: { values: SelectOption[]; at: number } | null = null;
const CACHE_MS = 5 * 60 * 1000;

/** Alle existierenden Stichwörter (paginiert), für die Komponenten-Combobox. */
export async function getLabels(): Promise<string[]> {
  if (labelCache && Date.now() - labelCache.at < CACHE_MS) return labelCache.values;

  const all: string[] = [];
  let startAt = 0;
  // Bis zu ~2000 Labels einsammeln (genug für die Vorschlagsliste).
  for (let i = 0; i < 20; i++) {
    const res = await jiraFetch(`/rest/api/3/label?maxResults=100&startAt=${startAt}`);
    if (!res.ok) break;
    const data = (await res.json()) as { values?: string[]; isLast?: boolean; total?: number };
    const values = data.values ?? [];
    all.push(...values);
    if (data.isLast || values.length === 0) break;
    startAt += values.length;
  }
  const sorted = Array.from(new Set(all)).sort((a, b) => a.localeCompare(b, "de"));
  labelCache = { values: sorted, at: Date.now() };
  return sorted;
}

/** System-Prioritäten (id + Name), "migrated"-Duplikate gefiltert. */
export async function getPriorities(): Promise<SelectOption[]> {
  if (priorityCache && Date.now() - priorityCache.at < CACHE_MS) return priorityCache.values;

  const res = await jiraFetch("/rest/api/3/priority");
  if (!res.ok) {
    throw new JiraError(`Prioritäten laden fehlgeschlagen (${res.status})`, res.status, await safeText(res));
  }
  const raw = (await res.json()) as Array<{ id: string; name: string }> | { values?: Array<{ id: string; name: string }> };
  const list = Array.isArray(raw) ? raw : (raw.values ?? []);
  const values = list
    .filter((p) => !/migrated/i.test(p.name))
    .map((p) => ({ id: p.id, label: p.name }));
  priorityCache = { values, at: Date.now() };
  return values;
}

/** Prüft per Jira-User-Suche, ob die E-Mail zu einem existierenden User gehört (fürs Login). */
export async function searchUserByEmail(email: string): Promise<boolean> {
  const res = await jiraFetch(`/rest/api/3/user/search?query=${encodeURIComponent(email)}`);
  if (!res.ok) {
    throw new JiraError(`Jira-User-Suche fehlgeschlagen (${res.status})`, res.status, await safeText(res));
  }
  const users = (await res.json()) as Array<{ emailAddress?: string }>;
  if (users.length === 0) return false;

  const needle = email.trim().toLowerCase();
  if (users.some((u) => (u.emailAddress ?? "").toLowerCase() === needle)) return true;

  // Manche Jira-User verstecken ihre E-Mail per Profil-Datenschutzeinstellung –
  // dann liefert Jira `emailAddress: ""`, obwohl die Suche selbst schon intern
  // gegen die (verborgene) E-Mail gematcht hat (sonst käme dieser eine Treffer
  // gar nicht zurück). Bei genau einem Ergebnis ohne emailAddress werten wir
  // das daher als Treffer.
  return users.length === 1 && !users[0].emailAddress;
}

/**
 * Bestehende Jira-Project-Components (echtes Components-Feld, nicht Labels).
 * `projectKey` optional – Standard ist das konfigurierte Default-Projekt.
 */
export async function getComponents(projectKey?: string, forceRefresh = false): Promise<SelectOption[]> {
  const key = projectKey || getJiraConfig().projectKey;
  const cached = componentCache.get(key);
  if (!forceRefresh && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.values;
  }
  const res = await jiraFetch(`/rest/api/2/project/${encodeURIComponent(key)}/components`);
  if (!res.ok) {
    throw new JiraError(`Komponenten laden fehlgeschlagen (${res.status})`, res.status, await safeText(res));
  }
  const raw = (await res.json()) as Array<{ id: string; name: string }>;
  const values = raw
    .map((c) => ({ id: c.id, label: c.name }))
    .sort((a, b) => a.label.localeCompare(b.label, "de"));
  componentCache.set(key, { values, at: Date.now() });
  return values;
}

/**
 * Findet eine Component per Name (case-insensitiv) oder legt sie in Jira neu an
 * (POST /rest/api/2/component – erfordert i. d. R. "Administer Projects" für den
 * Service-Account). Bei Konflikt durch eine parallele Anfrage wird erneut gesucht,
 * statt hart zu scheitern. `projectKey` optional – Standard ist das konfigurierte
 * Default-Projekt.
 */
export async function findOrCreateComponent(name: string, projectKey?: string): Promise<SelectOption> {
  const key = projectKey || getJiraConfig().projectKey;
  const needle = name.trim().toLowerCase();
  const existing = (await getComponents(key)).find((c) => c.label.toLowerCase() === needle);
  if (existing) return existing;

  const res = await jiraFetch("/rest/api/2/component", {
    method: "POST",
    body: { name: name.trim(), project: key },
  });
  if (res.ok) {
    const created = (await res.json()) as { id: string; name: string };
    componentCache.delete(key);
    return { id: created.id, label: created.name };
  }

  const retry = (await getComponents(key, true)).find((c) => c.label.toLowerCase() === needle);
  if (retry) return retry;

  throw new JiraError(`Komponente anlegen fehlgeschlagen (${res.status})`, res.status, await safeText(res));
}

/** Alle Jira-Projekte, die der Service-Account sehen kann (für das Zielprojekt-Dropdown). */
export async function getProjects(): Promise<SelectOption[]> {
  if (projectCache && Date.now() - projectCache.at < CACHE_MS) return projectCache.values;

  const all: SelectOption[] = [];
  let startAt = 0;
  for (let i = 0; i < 10; i++) {
    const res = await jiraFetch(`/rest/api/3/project/search?maxResults=50&startAt=${startAt}`);
    if (!res.ok) {
      throw new JiraError(`Projekte laden fehlgeschlagen (${res.status})`, res.status, await safeText(res));
    }
    const data = (await res.json()) as {
      values?: Array<{ key: string; name: string }>;
      isLast?: boolean;
    };
    const values = data.values ?? [];
    all.push(...values.map((p) => ({ id: p.key, label: `${p.key} – ${p.name}` })));
    if (data.isLast || values.length === 0) break;
    startAt += values.length;
  }
  const sorted = all.sort((a, b) => a.label.localeCompare(b.label, "de"));
  projectCache = { values: sorted, at: Date.now() };
  return sorted;
}
