import { cookies } from "next/headers";
import { verifySessionCookie, SESSION_COOKIE_NAME } from "@/lib/auth";
import { NewTicketForm } from "./NewTicketForm";

export default async function NewTicketPage() {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = cookie ? await verifySessionCookie(cookie) : null;

  return <NewTicketForm defaultReporterEmail={session?.email ?? ""} />;
}
