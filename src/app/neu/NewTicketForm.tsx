"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import Script from "next/script";
import {
  TICKET_TYPES,
  EXTRA_FIELDS,
  FALLBACK_PRIORITIES,
  isTicketGroup,
  type SelectOption,
} from "@/lib/ticketTypes";

// Turnstile ist optional: nur aktiv, wenn ein Sitekey gesetzt ist.
// Ohne NEXT_PUBLIC_TURNSTILE_SITEKEY läuft das Formular ohne Captcha (lokal praktisch).
const SITEKEY = process.env.NEXT_PUBLIC_TURNSTILE_SITEKEY ?? "";
const TURNSTILE_ENABLED = SITEKEY.length > 0;

const NEW_COMPONENT_VALUE = "__new__";

// Muss mit dem Limit in src/app/api/tickets/[key]/attachments/route.ts
// übereinstimmen (Vercel Route Handler haben ein hartes 4,5-MB-Request-Limit
// – jede Datei geht in einem eigenen Request, daher gilt das Limit pro Datei).
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 10;

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

declare global {
  interface Window {
    turnstile?: {
      getResponse: (widgetId?: string) => string | undefined;
      reset: (widgetId?: string) => void;
    };
  }
}

type Msg = { type: "success" | "error"; node: ReactNode } | null;

export function NewTicketForm({ defaultReporterEmail = "" }: { defaultReporterEmail?: string }) {
  const [selectedType, setSelectedType] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [defaultComponents, setDefaultComponents] = useState<SelectOption[]>([]);
  const [projectComponents, setProjectComponents] = useState<SelectOption[]>([]);
  const [componentChoice, setComponentChoice] = useState("");
  const [priorities, setPriorities] = useState<SelectOption[]>(FALLBACK_PRIORITIES);
  const [projects, setProjects] = useState<SelectOption[]>([]);
  const [targetProjectKey, setTargetProjectKey] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);

  const oversizedAttachments = attachments.filter((f) => f.size > MAX_ATTACHMENT_BYTES);

  function addAttachments(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setAttachments((prev) => [...prev, ...Array.from(fileList)].slice(0, MAX_ATTACHMENT_COUNT));
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  // Angezeigte Komponenten: Standard-Projekt-Liste, oder – sobald ein
  // abweichendes Zielprojekt gewählt wurde – dessen nachgeladene Liste.
  const components = targetProjectKey ? projectComponents : defaultComponents;

  // Auswahldaten (bestehende Stichwörter, Komponenten, Prioritäten, Projekte) laden.
  useEffect(() => {
    let active = true;
    fetch("/api/meta")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active || !d) return;
        if (Array.isArray(d.labels)) setLabels(d.labels);
        if (Array.isArray(d.components)) setDefaultComponents(d.components);
        if (Array.isArray(d.priorities) && d.priorities.length) setPriorities(d.priorities);
        if (Array.isArray(d.projects)) setProjects(d.projects);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Wechselt das Zielprojekt (nur beim Typ "Fehler" möglich), werden dessen
  // eigene Komponenten nachgeladen statt der Default-Projekt-Liste.
  // (componentChoice wird beim Auslösen des Wechsels im onChange zurückgesetzt.)
  useEffect(() => {
    if (!targetProjectKey) return;
    let active = true;
    fetch(`/api/meta?project=${encodeURIComponent(targetProjectKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active || !d || !Array.isArray(d.components)) return;
        setProjectComponents(d.components);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [targetProjectKey]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const form = e.currentTarget;
    const fd = new FormData(form);

    const tokenField = fd.get("cf-turnstile-response");
    const turnstileToken =
      (typeof tokenField === "string" && tokenField) ||
      window.turnstile?.getResponse() ||
      "";

    const type = (fd.get("type") as string) || "";

    // Typ-spezifische Auswahlfelder einsammeln (+ Pflicht-Check). Bei einem
    // abweichenden Zielprojekt (nur "Fehler") sind diese Felder nicht mehr
    // Pflicht, da sie dort ggf. gar nicht existieren.
    const customFields: Record<string, string | string[]> = {};
    if (isTicketGroup(type)) {
      for (const field of EXTRA_FIELDS[type]) {
        const fieldRequired = field.required && !targetProjectKey;
        if (field.multiple) {
          const values = fd.getAll(field.name).map((v) => v.toString());
          if (fieldRequired && values.length === 0) {
            return setMsg({ type: "error", node: `Bitte „${field.label}" auswählen.` });
          }
          if (values.length) customFields[field.name] = values;
        } else {
          const value = (fd.get(field.name) as string) || "";
          if (fieldRequired && !value) {
            return setMsg({ type: "error", node: `Bitte „${field.label}" auswählen.` });
          }
          if (value) customFields[field.name] = value;
        }
      }
    }

    const newComponentName = ((fd.get("newComponentName") as string) || "").trim();
    if (componentChoice === NEW_COMPONENT_VALUE && !newComponentName) {
      return setMsg({ type: "error", node: "Bitte einen Namen für die neue Komponente eingeben." });
    }

    const payload = {
      type,
      summary: ((fd.get("summary") as string) || "").trim(),
      description: ((fd.get("description") as string) || "").trim(),
      label: ((fd.get("label") as string) || "").trim(),
      componentId:
        componentChoice && componentChoice !== NEW_COMPONENT_VALUE ? componentChoice : undefined,
      newComponentName: componentChoice === NEW_COMPONENT_VALUE ? newComponentName : undefined,
      priority: (fd.get("priority") as string) || "",
      customFields,
      targetProjectKey: targetProjectKey || undefined,
      reporterName: ((fd.get("reporterName") as string) || "").trim(),
      reporterEmail: ((fd.get("reporterEmail") as string) || "").trim(),
      turnstileToken,
    };

    if (!payload.type) return setMsg({ type: "error", node: "Bitte eine Art des Anliegens wählen." });
    if (!payload.summary) return setMsg({ type: "error", node: "Bitte einen Titel eingeben." });
    if (TURNSTILE_ENABLED && !payload.turnstileToken)
      return setMsg({ type: "error", node: "Bitte die Sicherheitsprüfung (Captcha) abschließen." });
    if (oversizedAttachments.length > 0) {
      return setMsg({
        type: "error",
        node: `Zu groß (max. ${formatBytes(MAX_ATTACHMENT_BYTES)} pro Datei): ${oversizedAttachments.map((f) => f.name).join(", ")}`,
      });
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        key?: string;
        jiraUrl?: string;
        error?: string;
        warning?: string;
      };
      if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);

      // Anhänge einzeln nachladen (ein Request pro Datei, da Vercel ein
      // hartes 4,5-MB-Limit pro Request hat – so gilt es pro Datei statt für
      // die Summe aller Anhänge).
      let attachmentWarning: string | undefined;
      if (attachments.length > 0 && data.key) {
        const key = data.key;
        const results = await Promise.allSettled(
          attachments.map(async (file) => {
            const fileData = new FormData();
            fileData.append("file", file);
            const r = await fetch(`/api/tickets/${encodeURIComponent(key)}/attachments`, {
              method: "POST",
              body: fileData,
            });
            if (!r.ok) throw new Error(file.name);
          }),
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          attachmentWarning =
            failed === attachments.length
              ? "Anhänge konnten nicht hochgeladen werden."
              : `${failed} von ${attachments.length} Anhängen konnten nicht hochgeladen werden.`;
        }
      }
      data.warning = [data.warning, attachmentWarning].filter(Boolean).join(" ") || undefined;

      setMsg({
        type: "success",
        node: (
          <>
            ✅ Ticket <strong>{data.key}</strong> wurde angelegt.{" "}
            <a
              href={data.jiraUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline"
            >
              In Jira öffnen
            </a>{" "}
            ·{" "}
            <Link href="/" className="font-semibold underline">
              zum Liveticker
            </Link>
            {data.warning && <span className="mt-1 block text-amber-700">⚠ {data.warning}</span>}
          </>
        ),
      });
      form.reset();
      setSelectedType("");
      setComponentChoice("");
      setTargetProjectKey("");
      setAttachments([]);
      window.turnstile?.reset();
    } catch (err) {
      setMsg({
        type: "error",
        node: "❌ " + (err instanceof Error ? err.message : "Konnte nicht angelegt werden."),
      });
      window.turnstile?.reset();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {TURNSTILE_ENABLED && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
        />
      )}

      <div className="mx-auto max-w-2xl rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-5 text-xl font-semibold">Neues Ticket melden</h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Typ-Auswahl */}
          <fieldset>
            <legend className="mb-2 block text-sm font-semibold">Art des Anliegens</legend>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {TICKET_TYPES.map((t) => {
                const active = selectedType === t.key;
                return (
                  <label
                    key={t.key}
                    className={`cursor-pointer rounded-lg border-2 p-3 text-center transition ${
                      active
                        ? t.accentSelected
                        : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700"
                    }`}
                  >
                    <input
                      type="radio"
                      name="type"
                      value={t.key}
                      checked={active}
                      onChange={() => {
                        setSelectedType(t.key);
                        if (t.key !== "fehler") setTargetProjectKey("");
                      }}
                      className="sr-only"
                    />
                    <span className="block text-sm font-semibold">
                      {t.emoji} {t.formTitle}
                    </span>
                    <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                      {t.formDesc}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <Field label="Titel" hint="(kurz und prägnant)">
            <input
              type="text"
              name="summary"
              maxLength={255}
              required
              placeholder="z. B. Exportfunktion für Berichte"
              className={inputClass}
            />
          </Field>

          <Field label="Beschreibung" hint="(optional, aber hilfreich)">
            <textarea
              name="description"
              maxLength={5000}
              rows={5}
              placeholder="Worum geht es? Bei Fehlern: Schritte zum Nachstellen, erwartetes vs. tatsächliches Verhalten."
              className={`${inputClass} resize-y`}
            />
          </Field>

          {/* Anhänge: Screenshots/Dateien, werden nach dem Anlegen einzeln an den Vorgang gehängt */}
          <Field
            label="Anhänge"
            hint={`(optional – Screenshots/Dateien, je Datei max. ${formatBytes(MAX_ATTACHMENT_BYTES)}, max. ${MAX_ATTACHMENT_COUNT} Dateien)`}
          >
            <input
              type="file"
              multiple
              aria-label="Anhänge"
              onChange={(e) => {
                addAttachments(e.target.files);
                e.target.value = "";
              }}
              className={`${inputClass} cursor-pointer file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-700 hover:file:bg-zinc-200 dark:file:bg-zinc-800 dark:file:text-zinc-200`}
            />
            {attachments.length > 0 && (
              <ul className="mt-2 space-y-1">
                {attachments.map((file, i) => {
                  const tooLarge = file.size > MAX_ATTACHMENT_BYTES;
                  return (
                    <li
                      key={`${file.name}-${i}`}
                      className={`flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs ${
                        tooLarge
                          ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                          : "bg-zinc-50 dark:bg-zinc-800/60"
                      }`}
                    >
                      <span className="truncate">
                        {file.name} <span className="text-zinc-400">({formatBytes(file.size)})</span>
                        {tooLarge && " – zu groß"}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(i)}
                        className="shrink-0 text-zinc-400 hover:text-red-600"
                        aria-label={`${file.name} entfernen`}
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Field>

          {/* Komponente: echte Jira-Project-Components, mit Möglichkeit zur Neuanlage */}
          <Field label="Komponente" hint="(bestehende wählen oder neu anlegen)">
            <select
              name="componentChoice"
              aria-label="Komponente"
              value={componentChoice}
              onChange={(e) => setComponentChoice(e.target.value)}
              className={inputClass}
            >
              <option value="">— keine —</option>
              {components.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
              <option value={NEW_COMPONENT_VALUE}>+ Neue Komponente anlegen…</option>
            </select>
            {componentChoice === NEW_COMPONENT_VALUE && (
              <input
                type="text"
                name="newComponentName"
                required
                maxLength={120}
                placeholder="Name der neuen Komponente"
                className={`${inputClass} mt-2`}
              />
            )}
          </Field>

          {/* Label: freies Jira-Stichwort, bestehende als Vorschläge + freie Eingabe */}
          <Field label="Label" hint="(Stichwort – bestehendes wählen oder neu eingeben)">
            <input
              type="text"
              name="label"
              list="label-list"
              aria-label="Label"
              maxLength={120}
              placeholder="z. B. cati, backend, Anforderungsportal …"
              className={inputClass}
            />
            <datalist id="label-list">
              {labels.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </Field>

          <Field label="Priorität" hint="(optional)">
            <select name="priority" aria-label="Priorität" className={inputClass} defaultValue="">
              <option value="">— keine —</option>
              {priorities.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>

          {/* Zielprojekt: nur beim Fehler-Typ, optional – ohne Auswahl geht der Bug ins Default-Projekt */}
          {selectedType === "fehler" && (
            <Field
              label="Zielprojekt"
              hint="(optional – ohne Auswahl: Standardprojekt)"
            >
              <select
                aria-label="Zielprojekt"
                value={targetProjectKey}
                onChange={(e) => {
                  setTargetProjectKey(e.target.value);
                  setComponentChoice("");
                }}
                className={inputClass}
              >
                <option value="">Standard (WIDEA)</option>
                {projects
                  .filter((p) => p.id !== "WIDEA")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
              </select>
              {targetProjectKey && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Fehlertyp/Fehlerklasse/Umgebung existieren dort ggf. nicht als eigenes Feld und
                  werden stattdessen in die Beschreibung übernommen.
                </p>
              )}
            </Field>
          )}

          {/* Typ-spezifische Felder (z. B. Fehlertyp/Fehlerklasse/Umgebung beim Fehler) */}
          {isTicketGroup(selectedType) &&
            EXTRA_FIELDS[selectedType].map((field) => {
              const fieldRequired = field.required && !targetProjectKey;
              return field.multiple ? (
                <fieldset key={field.name}>
                  <legend className="mb-1.5 block text-sm font-semibold">
                    {field.label}{" "}
                    <span className="font-normal text-zinc-500 dark:text-zinc-400">
                      {fieldRequired ? "(erforderlich)" : "(optional, Mehrfachauswahl)"}
                    </span>
                  </legend>
                  <div className="flex flex-wrap gap-3">
                    {field.options.map((o) => (
                      <label key={o.id} className="inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" name={field.name} value={o.id} className="h-4 w-4" />
                        {o.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : (
                <Field
                  key={field.name}
                  label={field.label}
                  hint={fieldRequired ? "(erforderlich)" : "(optional)"}
                >
                  <select
                    name={field.name}
                    aria-label={field.label}
                    required={fieldRequired}
                    className={inputClass}
                    defaultValue=""
                  >
                    <option value="">— bitte wählen —</option>
                    {field.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
              );
            })}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Dein Name" hint="(optional)">
              <input
                type="text"
                name="reporterName"
                aria-label="Dein Name"
                maxLength={120}
                className={inputClass}
              />
            </Field>
            <Field label="Deine E-Mail" hint="(optional)">
              <input
                type="email"
                name="reporterEmail"
                aria-label="Deine E-Mail"
                maxLength={120}
                defaultValue={defaultReporterEmail}
                className={inputClass}
              />
            </Field>
          </div>

          {TURNSTILE_ENABLED && (
            <div className="cf-turnstile" data-sitekey={SITEKEY} data-theme="auto" />
          )}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Wird angelegt…" : "Ticket anlegen"}
          </button>

          {msg && (
            <div
              className={`rounded-lg px-4 py-3 text-sm ${
                msg.type === "success"
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "border border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
              }`}
            >
              {msg.node}
            </div>
          )}
        </form>
      </div>
    </>
  );
}

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">
        {label}{" "}
        {hint && <span className="font-normal text-zinc-500 dark:text-zinc-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
