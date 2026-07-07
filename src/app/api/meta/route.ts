import { NextResponse, type NextRequest } from "next/server";
import { getLabels, getPriorities, getComponents, getProjects, JiraError } from "@/lib/jira";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liefert Auswahldaten fürs Formular: bestehende Stichwörter (Label),
// System-Prioritäten, Jira-Project-Components und verfügbare Projekte.
// Serverseitig 5 Min. gecacht. Mit ?project=KEY werden nur die Komponenten
// dieses Projekts nachgeladen (fürs Zielprojekt-Dropdown beim Fehler-Typ).
export async function GET(req: NextRequest) {
  try {
    const project = req.nextUrl.searchParams.get("project");
    if (project) {
      const components = await getComponents(project);
      return NextResponse.json({ components }, { headers: { "Cache-Control": "no-store" } });
    }

    const [labels, priorities, components, projects] = await Promise.all([
      getLabels(),
      getPriorities(),
      getComponents(),
      getProjects(),
    ]);
    return NextResponse.json(
      { labels, priorities, components, projects },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[api/meta]", err);
    const status = err instanceof JiraError ? err.status || 502 : 500;
    return NextResponse.json({ error: "Meta-Daten konnten nicht geladen werden" }, { status });
  }
}
