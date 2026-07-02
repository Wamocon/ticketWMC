import Link from "next/link";
import { cookies } from "next/headers";
import { verifySessionCookie, SESSION_COOKIE_NAME } from "@/lib/auth";
import { LogoutButton } from "@/components/LogoutButton";

export async function SiteHeader() {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = cookie ? await verifySessionCookie(cookie) : null;

  return (
    <header className="border-b border-zinc-800 bg-zinc-900 text-zinc-50">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="text-base font-semibold tracking-tight">
            WMC Ticketsystem
          </span>
        </Link>

        <nav className="flex items-center gap-2">
          {session ? (
            <>
              <Link
                href="/"
                className="rounded-full px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
              >
                Liveticker
              </Link>
              <Link
                href="/neu"
                className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
              >
                + Neues Ticket
              </Link>
              <span className="hidden text-xs text-zinc-400 sm:inline">
                {session.isGuest ? "Gast" : session.email}
              </span>
              <LogoutButton />
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
            >
              Anmelden
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
