"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";

type Msg = { type: "success" | "error"; text: string } | null;

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

function LoginForm() {
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/";
  const expired = searchParams.get("error") === "expired";

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState(false);

  const [showGuest, setShowGuest] = useState(false);
  const [guestCode, setGuestCode] = useState("");
  const [guestSubmitting, setGuestSubmitting] = useState(false);
  const [guestMsg, setGuestMsg] = useState<Msg>(null);

  async function handleEmailSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    setDevLink(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, redirect }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        devLink?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error || `Fehler ${res.status}`);
      setLinkSent(true);
      setMsg({ type: "success", text: "Login-Link verschickt. Bitte E-Mail-Postfach prüfen." });
      if (data.devLink) setDevLink(data.devLink);
    } catch (err) {
      setMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Anfrage fehlgeschlagen.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGuestSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setGuestMsg(null);
    setGuestSubmitting(true);
    try {
      const res = await fetch("/api/auth/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: guestCode }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || `Fehler ${res.status}`);
      window.location.href = redirect;
    } catch (err) {
      setGuestMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Zugangscode ungültig.",
      });
    } finally {
      setGuestSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-1 text-xl font-semibold">Anmelden</h2>
      <p className="mb-5 text-sm text-zinc-500 dark:text-zinc-400">
        Gib deine E-Mail-Adresse ein. Ist sie einem Jira-Account zugeordnet, schicken wir dir einen
        Login-Link.
      </p>

      {expired && !msg && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Der Login-Link ist abgelaufen oder ungültig. Bitte fordere einen neuen an.
        </div>
      )}

      <form onSubmit={handleEmailSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">E-Mail</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={linkSent}
            placeholder="du@wamocon.de"
            className={inputClass}
          />
        </label>

        {!linkSent ? (
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Wird gesendet…" : "Login-Link anfordern"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setLinkSent(false);
              setMsg(null);
              setDevLink(null);
            }}
            className="w-full rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Andere E-Mail-Adresse verwenden
          </button>
        )}

        {msg && (
          <div
            className={`rounded-lg px-4 py-3 text-sm ${
              msg.type === "success"
                ? "border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "border border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            }`}
          >
            {msg.text}
          </div>
        )}

        {devLink && (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs dark:border-zinc-700 dark:bg-zinc-950">
            <p className="mb-1 font-semibold text-zinc-600 dark:text-zinc-300">
              Dev-Modus (kein Mailversand konfiguriert):
            </p>
            <a href={devLink} className="break-all text-blue-600 underline dark:text-blue-400">
              {devLink}
            </a>
          </div>
        )}
      </form>

      <div className="mt-6 border-t border-zinc-200 pt-5 dark:border-zinc-800">
        {!showGuest ? (
          <button
            type="button"
            onClick={() => setShowGuest(true)}
            className="text-sm font-medium text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Als Gast anmelden
          </button>
        ) : (
          <form onSubmit={handleGuestSubmit} className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold">Gast-Zugangscode</span>
              <input
                type="password"
                required
                value={guestCode}
                onChange={(e) => setGuestCode(e.target.value)}
                className={inputClass}
              />
            </label>
            <button
              type="submit"
              disabled={guestSubmitting}
              className="w-full rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {guestSubmitting ? "Wird geprüft…" : "Als Gast anmelden"}
            </button>
            {guestMsg && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {guestMsg.text}
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
