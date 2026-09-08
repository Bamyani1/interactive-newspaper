import AskWorkspace from "./AskWorkspace";

// Revalidate the server-provided daily prompt seed without letting the client
// clock diverge from the HTML that React hydrates. The corpus counts below
// ride the same window.
export const revalidate = 3_600;

/**
 * What the landing claimed before it was allowed to ask.
 *
 * These were hardcoded in the component, so every edition added to the
 * archive made the page quietly wrong, and nobody would notice. They stay
 * as the fallback: a database outage should render a plausible page rather
 * than a landing advertising nothing.
 */
export const FALLBACK_CORPUS = { editionCount: 351, articleCount: 11_705 };

async function readCorpusCounts(): Promise<typeof FALLBACK_CORPUS> {
  // Imported lazily and only with a URL configured: `db.ts` opens its Neon
  // client at module load, and a prerender in an environment without one
  // would fail the whole page rather than degrade this line of copy.
  if (!process.env.DATABASE_URL) return FALLBACK_CORPUS;
  try {
    const { queryArchiveCoverage } = await import("@/src/lib/db");
    const stats = await queryArchiveCoverage({ timeoutMs: 2_000 });
    if (stats.editionCount > 0 && stats.articleCount > 0) {
      return { editionCount: stats.editionCount, articleCount: stats.articleCount };
    }
  } catch {
    // Raced out or unreachable. One line of landing copy is not worth
    // failing a page render for.
  }
  return FALLBACK_CORPUS;
}

export default async function AskPage() {
  const suggestionDate = new Date().toISOString().slice(0, 10);
  const corpus = await readCorpusCounts();
  return <AskWorkspace suggestionDate={suggestionDate} corpus={corpus} />;
}
