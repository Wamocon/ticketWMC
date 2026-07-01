"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TICKET_TYPES, urgencyRank, type Ticket } from "@/lib/ticketTypes";
import { TicketCard } from "@/components/TicketCard";

const POLL_INTERVAL_MS = 30_000; // 30 s – komfortabel im Jira-Rate-Limit

function byUrgencyThenDate(a: Ticket, b: Ticket): number {
  const u = urgencyRank(b) - urgencyRank(a);
  if (u !== 0) return u;
  const da = a.created ? Date.parse(a.created) : 0;
  const db = b.created ? Date.parse(b.created) : 0;
  return db - da;
}

export default function Dashboard() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [newKeys, setNewKeys] = useState<Set<string>>(new Set());
  const [lastUpdated, setLastUpdated] = useState<string>("–");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [componentFilter, setComponentFilter] = useState("");
  const [showDone, setShowDone] = useState(true);

  const seenKeys = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tickets", { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { tickets: Ticket[] };
      const list = data.tickets ?? [];

      const fresh = firstLoad.current
        ? new Set<string>()
        : new Set(list.filter((t) => !seenKeys.current.has(t.key)).map((t) => t.key));

      setTickets(list);
      setNewKeys(fresh);
      setError(null);
      setLastUpdated(new Date().toLocaleTimeString("de-DE"));
      seenKeys.current = new Set(list.map((t) => t.key));
      firstLoad.current = false;
      setLoaded(true);
    } catch (err) {
      setError(
        "Tickets konnten nicht geladen werden. Nächster Versuch in Kürze… (" +
          (err instanceof Error ? err.message : "Fehler") +
          ")",
      );
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(load, 0);
    const id = setInterval(load, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const allComponents = useMemo(
    () =>
      Array.from(new Set(tickets.flatMap((t) => t.components))).sort((a, b) =>
        a.localeCompare(b, "de"),
      ),
    [tickets],
  );

  const visible = useMemo(
    () =>
      componentFilter
        ? tickets.filter((t) => t.components.includes(componentFilter))
        : tickets,
    [tickets, componentFilter],
  );

  return (
    <div>
      {/* Statuszeile */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          Live – aktualisiert automatisch
        </span>
        <span className="inline-flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          Zuletzt: {lastUpdated}
          <button
            type="button"
            onClick={load}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Jetzt aktualisieren
          </button>
        </span>
      </div>

      {/* Filter- & Strukturleiste */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <label className="inline-flex items-center gap-2">
          <span className="text-zinc-500 dark:text-zinc-400">Komponente:</span>
          <select
            aria-label="Nach Komponente filtern"
            value={componentFilter}
            onChange={(e) => setComponentFilter(e.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="">Alle</option>
            {allComponents.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-zinc-600 dark:text-zinc-300">Erledigte anzeigen</span>
        </label>

        <span className="ml-auto hidden items-center gap-2 text-xs text-zinc-400 sm:inline-flex">
          Dringlichkeit:
          <Legend color="bg-red-500" label="Kritisch" />
          <Legend color="bg-orange-500" label="Dringend" />
          <Legend color="bg-amber-400" label="Mittel" />
          <Legend color="bg-zinc-300 dark:bg-zinc-600" label="Niedrig" />
        </span>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {TICKET_TYPES.map((meta) => {
          const items = visible.filter((t) => t.group === meta.key);
          const open = items.filter((t) => t.statusCategory !== "done").sort(byUrgencyThenDate);
          const done = items.filter((t) => t.statusCategory === "done").sort(byUrgencyThenDate);

          return (
            <section
              key={meta.key}
              className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <header
                className={`flex items-center justify-between border-t-4 ${meta.accentBorder} border-b border-zinc-200 px-4 py-3 dark:border-b-zinc-800`}
              >
                <span className="font-semibold">
                  {meta.emoji} {meta.columnLabel}
                </span>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {open.length} offen{done.length ? ` · ${done.length} erledigt` : ""}
                </span>
              </header>

              <div className="flex flex-col gap-2.5 p-3">
                {!loaded ? (
                  <p className="py-5 text-center text-sm text-zinc-400">Lade…</p>
                ) : open.length === 0 && done.length === 0 ? (
                  <p className="py-5 text-center text-sm text-zinc-400">Keine Einträge</p>
                ) : (
                  <>
                    {open.map((ticket) => (
                      <TicketCard key={ticket.key} ticket={ticket} isNew={newKeys.has(ticket.key)} />
                    ))}

                    {showDone && done.length > 0 && (
                      <>
                        <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                          Erledigt ({done.length})
                          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                        </div>
                        {done.map((ticket) => (
                          <TicketCard
                            key={ticket.key}
                            ticket={ticket}
                            isNew={newKeys.has(ticket.key)}
                            compact
                          />
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2.5 w-2.5 rounded-sm ${color}`} />
      {label}
    </span>
  );
}
