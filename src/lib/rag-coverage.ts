import type { CoverageIntent } from "@/src/lib/query-reformulator";

/** One period of a comparison and what the archive holds for it. */
export interface ArchiveCoveragePeriod {
  startDate: string;
  endDate: string;
  editionCount: number;
  articleCount: number;
}

export interface ArchiveCoverage {
  /** "comparison" when only the question's separate periods called for scope. */
  intent: Exclude<CoverageIntent, "none"> | "comparison";
  editionCount: number;
  articleCount: number;
  earliestEditionDate: string | null;
  latestEditionDate: string | null;
  requestedStartDate?: string;
  requestedEndDate?: string;
  category?: string;
  corpusVersion: string;
  retrievalTarget: "legacy" | "versioned";
  /** Pre-computed chronological digest of the requested year, when the
   * question targets a single archive year. Trusted guidance, never
   * citable evidence. */
  yearDigest?: string;
  /**
   * Per-period scope when the question compares separate periods. The
   * single span above runs from the first to the last and so counts every
   * issue in between, which for "the 1960s versus the 1990s" is mostly the
   * 1970s and 1980s.
   */
  periods?: ArchiveCoveragePeriod[];
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : pluralForm}`;
}

function yearSpan(startDate: string, endDate: string): string {
  const from = startDate.slice(0, 4);
  const to = endDate.slice(0, 4);
  return from === to ? from : `${from}–${to}`;
}

export function describeCoverageScope(coverage: ArchiveCoverage): string {
  if (coverage.periods?.length) {
    const category = coverage.category ? ` (${coverage.category} category)` : "";
    return (
      coverage.periods
        .map(
          (period) =>
            `${yearSpan(period.startDate, period.endDate)}: ${plural(period.editionCount, "indexed edition")} containing ${plural(period.articleCount, "searchable article")}`
        )
        .join("; ") + category
    );
  }
  const dateSpan =
    coverage.earliestEditionDate && coverage.latestEditionDate
      ? ` dated ${coverage.earliestEditionDate} through ${coverage.latestEditionDate}`
      : " in the requested date range";
  const category = coverage.category ? ` in the ${coverage.category} category` : "";
  return `${plural(coverage.editionCount, "indexed edition")}${dateSpan}, containing ${plural(coverage.articleCount, "searchable article")}${category}`;
}

// A comparison answer weighed a column and a syndicated comic strip from
// 1990-91 against seven 1960s articles and called the difference student
// apathy. Uneven evidence can be a finding about the paper or a limit of
// the archive; the per-period scope is what tells the two apart.
const COMPARISON_RULES = `
- This question compares periods. Weigh each period's evidence separately and say how many cited sources support each side.
- If one period rests on far fewer or weaker sources than another (a single column, a syndicated comic or wire item), say so plainly before drawing any conclusion from the difference.
- Use the per-period scope above to say which it is: little evidence from a period with many searchable editions is a finding about the paper's coverage; little evidence from a period with few searchable editions is a limit of this archive.`;

/**
 * Trusted metadata block for questions whose wording depends on the scope that
 * was actually searchable. It is deliberately labeled as metadata rather than
 * evidence so the model cannot use an edition count to support a historical
 * claim.
 */
export function buildCoveragePromptBlock(coverage?: ArchiveCoverage): string {
  if (!coverage) return "";
  return `DETERMINISTIC ARCHIVE COVERAGE METADATA (not factual evidence):
- Coverage intent: ${coverage.intent}
- Searchable scope: ${describeCoverageScope(coverage)}
- Corpus version: ${coverage.corpusVersion}
- Retrieval target: ${coverage.retrievalTarget}

COVERAGE RULES:
- Use this metadata only to describe what archive scope was searchable.
- The reader already sees this scope above the answer. Do not open with a scope section or restate the edition and article counts; mention the scope only where it explains why evidence is thin.
- A positive historical claim still requires a cited article; coverage metadata never supports a source claim.
- If no relevant cited evidence was found, say that no matching evidence was found in the indexed scope. Never claim that the event or subject was absent from every newspaper page.
- For count or exhaustive questions, do not imply a database-wide exact result unless the cited evidence itself establishes that result.
- Do not lower confidence in a supported positive claim merely because editions outside the requested scope were not searched.${
    coverage.periods?.length ? COMPARISON_RULES : ""
  }${
    coverage.yearDigest
      ? `

YEAR DIGEST (trusted editorial index of the requested year's coverage; NOT citable evidence):
${coverage.yearDigest}

DIGEST RULES:
- Use the digest only to organize a comprehensive answer and to know what coverage exists.
- Never cite the digest. Every specific factual claim (names, dates, scores, outcomes) must be supported by a cited article source.
- A story that appears only in the digest may be mentioned as a topic the archive covered, without specific details or citations.`
      : ""
  }`;
}

function noEvidenceAnswer(coverage: ArchiveCoverage): string {
  const scope = describeCoverageScope(coverage);
  if (coverage.intent === "absence") {
    return `No matching evidence was found in ${scope}. This does not establish that the subject was absent from every newspaper page; it only describes the indexed archive evidence.`;
  }
  // Non-absence intents must not overclaim: reaching this branch means no
  // citation SURVIVED verification, not that the archive holds nothing —
  // retrieval may well have found candidates the answer failed to ground.
  return `I couldn't ground a verifiable answer for this question in ${scope}. That reflects this attempt, not proven absence — a more specific phrasing (a name, event, or date) may surface the coverage.`;
}

/**
 * Enforces the coverage wording after model output has already passed citation
 * allowlisting. With no verified citation, model prose is replaced by a safe,
 * deterministic no-evidence statement. With citations, the answer is returned
 * verbatim, so a supported positive claim keeps its evidence-derived
 * confidence.
 *
 * The scope itself is no longer appended as prose. It was a paragraph of
 * metadata ("Coverage note: the searchable scope contained 216 indexed
 * editions…") sitting under every answer, in the same voice as the answer,
 * saying nothing about the question — read as filler and skipped. It travels
 * to the client as `meta.coverage` instead, where the transcript can present
 * it as what it is: the scope that was searched, shown before the reader
 * decides how much to trust a thin answer.
 */
export function applyCoverageAnswerPolicy(
  answer: string,
  citationCount: number,
  coverage?: ArchiveCoverage
): string {
  if (!coverage) return answer;
  if (citationCount === 0) return noEvidenceAnswer(coverage);
  return answer.trim();
}
