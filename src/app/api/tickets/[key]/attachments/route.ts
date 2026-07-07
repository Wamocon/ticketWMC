import { NextResponse, type NextRequest } from "next/server";
import { addAttachment, JiraError } from "@/lib/jira";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ein Anhang pro Request: Vercel Route Handler haben ein hartes 4,5-MB-Limit
// pro Request. Getrennt von der Ticket-Anlage lässt sich dieses Limit so pro
// Datei statt für die Summe aller Anhänge nutzen (beliebig viele Screenshots,
// solange jede Datei einzeln darunter bleibt).
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await params;
    const ip = clientIp(req);

    const rl = rateLimit(`attach:${ip}`, 30, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Zu viele Anfragen. Bitte kurz warten." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      );
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Keine Datei übermittelt" }, { status: 400 });
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        { error: `Datei zu groß (max. ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB pro Datei)` },
        { status: 400 },
      );
    }

    await addAttachment(key, file);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/tickets/[key]/attachments]", err);
    if (err instanceof JiraError) {
      console.error("Jira-Detail:", err.detail);
      return NextResponse.json(
        { error: "Anhang konnte nicht hochgeladen werden" },
        { status: err.status || 502 },
      );
    }
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
