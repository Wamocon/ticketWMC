// Geteilte, geheimnisfreie Konfiguration für Client und Server.
// Einzige Wahrheitsquelle für die Zuordnung der drei Ticket-Arten.

export type TicketGroup = "idee" | "optimierung" | "fehler";

export interface TicketTypeMeta {
  key: TicketGroup;
  /** Spaltenüberschrift im Dashboard */
  columnLabel: string;
  /** Titel der Auswahlkachel im Formular */
  formTitle: string;
  /** Kurzbeschreibung der Auswahlkachel */
  formDesc: string;
  emoji: string;
  /** Echter Jira-Issue-Type-Name im Projekt WIDEA */
  jiraType: string;
  /** Tailwind-Klasse für die obere Akzentlinie der Spalte */
  accentBorder: string;
  /** Tailwind-Klassen für die ausgewählte Formular-Kachel */
  accentSelected: string;
}

export const TICKET_TYPES: TicketTypeMeta[] = [
  {
    key: "idee",
    columnLabel: "Produktideen",
    formTitle: "Produktidee",
    formDesc: "Neue Funktion oder neues Produkt",
    emoji: "💡",
    jiraType: "Produkt",
    accentBorder: "border-t-violet-500",
    accentSelected:
      "border-violet-500 bg-violet-50 dark:border-violet-400 dark:bg-violet-950/40",
  },
  {
    key: "optimierung",
    columnLabel: "Optimierungen",
    formTitle: "Optimierung",
    formDesc: "Vorgehen oder Prozess verbessern",
    emoji: "⚙️",
    jiraType: "Vorgehen",
    accentBorder: "border-t-cyan-500",
    accentSelected:
      "border-cyan-500 bg-cyan-50 dark:border-cyan-400 dark:bg-cyan-950/40",
  },
  {
    key: "fehler",
    columnLabel: "Fehler / Probleme",
    formTitle: "Fehler / Problem",
    formDesc: "Etwas funktioniert nicht",
    emoji: "🐞",
    jiraType: "Bug",
    accentBorder: "border-t-red-500",
    accentSelected:
      "border-red-500 bg-red-50 dark:border-red-400 dark:bg-red-950/40",
  },
];

export const GROUP_ORDER: TicketGroup[] = ["idee", "optimierung", "fehler"];

/** Frontend-Gruppe → echter Jira-Issue-Type-Name */
export const GROUP_TO_JIRA_TYPE: Record<TicketGroup, string> =
  Object.fromEntries(TICKET_TYPES.map((t) => [t.key, t.jiraType])) as Record<
    TicketGroup,
    string
  >;

/** Echter Jira-Issue-Type-Name → Frontend-Gruppe */
export const JIRA_TYPE_TO_GROUP: Record<string, TicketGroup> =
  Object.fromEntries(TICKET_TYPES.map((t) => [t.jiraType, t.key]));

export function isTicketGroup(value: string): value is TicketGroup {
  return value === "idee" || value === "optimierung" || value === "fehler";
}

// ── Feld-Mapping pro Typ (aus echter Jira-createmeta von WIDEA) ──

export interface SelectOption {
  id: string;
  label: string;
}

/** Pflicht-/Wahl-Feld eines Vorgangstyps, das als Dropdown abgefragt wird. */
export interface ExtraSelectField {
  /** Jira-Feld-ID, z. B. "customfield_10490" */
  fieldId: string;
  /** Name im Formular/Payload */
  name: string;
  label: string;
  required: boolean;
  /** true = Mehrfachauswahl (Jira-Array-Feld) */
  multiple?: boolean;
  options: SelectOption[];
}

// Feste Jira-Feld-IDs im Projekt WIDEA (für Lese- und Schreibseite).
export const FIELD_FEHLERTYP = "customfield_10490";
export const FIELD_FEHLERKLASSE = "customfield_10655";
export const FIELD_UMGEBUNG = "customfield_10822";

/**
 * Welches Jira-Feld nimmt den Freitext ("Beschreibung") je Typ auf?
 * Bug hat ein echtes `description`-Feld; Produkt/Vorgehen haben das nicht –
 * dort wird "Problembeschreibung" (customfield_10776) genutzt.
 */
export const DESCRIPTION_FIELD: Record<TicketGroup, string> = {
  idee: "customfield_10776",
  optimierung: "customfield_10776",
  fehler: "description",
};

/** Zusätzliche (Pflicht-)Auswahlfelder je Typ. */
export const EXTRA_FIELDS: Record<TicketGroup, ExtraSelectField[]> = {
  idee: [],
  optimierung: [],
  fehler: [
    {
      fieldId: FIELD_FEHLERTYP,
      name: "fehlertyp",
      label: "Fehlertyp",
      required: true,
      options: [
        { id: "10195", label: "Funktion" },
        { id: "10196", label: "Technischer Fehler" },
        { id: "10197", label: "Daten" },
        { id: "10198", label: "Design" },
        { id: "10199", label: "Berechtigung" },
        { id: "10200", label: "Umgebung" },
      ],
    },
    {
      fieldId: FIELD_FEHLERKLASSE,
      name: "fehlerklasse",
      label: "Fehlerklasse",
      required: true,
      options: [
        { id: "10261", label: "Sehr Hoch" },
        { id: "10262", label: "Hoch" },
        { id: "10263", label: "Mittel" },
        { id: "10264", label: "Niedrig" },
      ],
    },
    {
      fieldId: FIELD_UMGEBUNG,
      name: "umgebung",
      label: "Umgebung",
      required: false,
      multiple: true,
      options: [
        { id: "10417", label: "Lokal" },
        { id: "10418", label: "Test (Preview)" },
        { id: "10419", label: "Produktion" },
      ],
    },
  ],
};

/** An den Client ausgeliefertes, bereinigtes Ticket. */
export interface Ticket {
  key: string;
  summary: string;
  type: string;
  group: TicketGroup | "sonstige";
  status: string;
  statusCategory: string; // new | indeterminate | done
  priority: string | null;
  components: string[]; // = Jira-Stichwörter (Komponente)
  fehlertyp: string | null;
  fehlerklasse: string | null;
  umgebung: string[];
  assignee: string | null;
  reporter: string | null;
  created: string | null;
  updated: string | null;
  jiraUrl: string;
}

// ── Dringlichkeit: für Sortierung und visuelle Abstufung ────────
// Rang 5 = kritisch … 0 = ohne. Speist sich aus System-Priorität
// und (bei Fehlern) der Fehlerklasse – es zählt der höhere Wert.
const PRIORITY_RANK: Record<string, number> = {
  Highest: 5,
  High: 4,
  Medium: 3,
  Low: 2,
  "Low (migrated)": 2,
  Lowest: 1,
};
const FEHLERKLASSE_RANK: Record<string, number> = {
  "Sehr Hoch": 5,
  Hoch: 4,
  Mittel: 3,
  Niedrig: 2,
};

export function urgencyRank(t: Ticket): number {
  const p = t.priority ? (PRIORITY_RANK[t.priority] ?? 0) : 0;
  const f = t.fehlerklasse ? (FEHLERKLASSE_RANK[t.fehlerklasse] ?? 0) : 0;
  return Math.max(p, f);
}

export interface UrgencyStyle {
  /** linke Akzentkante + Tönung der Karte */
  card: string;
  /** Kurzlabel der Stufe */
  label: string;
}

export function urgencyStyle(rank: number): UrgencyStyle {
  switch (rank) {
    case 5:
      return { card: "border-l-4 border-l-red-500 bg-red-50/60 dark:bg-red-950/20", label: "Kritisch" };
    case 4:
      return { card: "border-l-4 border-l-orange-500 bg-orange-50/50 dark:bg-orange-950/20", label: "Dringend" };
    case 3:
      return { card: "border-l-4 border-l-amber-400", label: "Mittel" };
    case 2:
      return { card: "border-l-4 border-l-zinc-300 dark:border-l-zinc-600", label: "Niedrig" };
    default:
      return { card: "border-l-4 border-l-transparent", label: "" };
  }
}

/** Standard-Prioritäten (für das Formular, falls /api/meta nicht erreichbar). */
export const FALLBACK_PRIORITIES: SelectOption[] = [
  { id: "1", label: "Highest" },
  { id: "2", label: "High" },
  { id: "3", label: "Medium" },
  { id: "10000", label: "Low" },
  { id: "10002", label: "Lowest" },
];

/** Stichwort/Komponente Jira-konform machen (keine Leerzeichen erlaubt). */
export function sanitizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, "-");
}
