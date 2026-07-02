import { NextResponse } from "next/server";
import { getLabels, getPriorities, getComponents, JiraError } from "@/lib/jira";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liefert Auswahldaten fürs Formular: bestehende Stichwörter (Label),
// System-Prioritäten und Jira-Project-Components. Serverseitig 5 Min. gecacht.
export async function GET() {
  try {
    const [labels, priorities, components] = await Promise.all([
      getLabels(),
      getPriorities(),
      getComponents(),
    ]);
    return NextResponse.json(
      { labels, priorities, components },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[api/meta]", err);
    const status = err instanceof JiraError ? err.status || 502 : 500;
    return NextResponse.json({ error: "Meta-Daten konnten nicht geladen werden" }, { status });
  }
}
