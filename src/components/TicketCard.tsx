import { type Ticket, urgencyRank, urgencyStyle } from "@/lib/ticketTypes";
import { formatRelativeTime } from "@/lib/relativeTime";

const STATUS_STYLES: Record<string, string> = {
  new: "bg-zinc-500 text-white",
  indeterminate: "bg-blue-600 text-white",
  done: "bg-emerald-600 text-white",
};

export function TicketCard({
  ticket,
  isNew,
  compact = false,
}: {
  ticket: Ticket;
  isNew: boolean;
  compact?: boolean;
}) {
  const statusClass = STATUS_STYLES[ticket.statusCategory] ?? "bg-zinc-500 text-white";
  const urgency = urgencyStyle(urgencyRank(ticket));

  // Erledigte Tickets: kompakt, gedimmt, ohne Dringlichkeits-Akzent.
  const accent = compact ? "border-l-4 border-l-transparent opacity-70" : urgency.card;

  return (
    <a
      href={ticket.jiraUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`block rounded-lg border border-zinc-200 bg-white transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900 ${accent} ${
        compact ? "px-2.5 py-1.5" : "p-3"
      } ${isNew ? "animate-ticket-flash" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">{ticket.key}</span>
        {ticket.created && (
          <span className="text-[0.7rem] text-zinc-400">{formatRelativeTime(ticket.created)}</span>
        )}
      </div>

      <p
        className={`mt-0.5 text-zinc-900 dark:text-zinc-100 ${
          compact ? "truncate text-xs" : "mb-2 text-sm"
        }`}
      >
        {ticket.summary}
      </p>

      {!compact && (
        <div className="flex flex-wrap items-center gap-1.5">
          {ticket.status && (
            <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${statusClass}`}>
              {ticket.status}
            </span>
          )}
          {ticket.priority && <Badge className="bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900">⚑ {ticket.priority}</Badge>}
          {ticket.fehlerklasse && <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">Klasse: {ticket.fehlerklasse}</Badge>}
          {ticket.fehlertyp && <Badge className="bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{ticket.fehlertyp}</Badge>}
          {ticket.components.map((c) => (
            <Badge key={c} className="bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
              # {c}
            </Badge>
          ))}
          {ticket.labels.map((l) => (
            <Badge key={l} className="bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
              🏷 {l}
            </Badge>
          ))}
          {ticket.umgebung.map((u) => (
            <Badge key={u} className="bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
              {u}
            </Badge>
          ))}
        </div>
      )}
    </a>
  );
}

function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`max-w-full truncate rounded-full px-2 py-0.5 text-[0.7rem] font-medium ${className}`}>
      {children}
    </span>
  );
}
