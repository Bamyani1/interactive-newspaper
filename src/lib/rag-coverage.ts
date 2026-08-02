import type { CoverageIntent } from "@/src/lib/query-reformulator";

export interface ArchiveCoverage {
    intent: Exclude<CoverageIntent, "none">;
    editionCount: number;
    articleCount: number;
    earliestEditionDate: string | null;
    latestEditionDate: string | null;
    requestedStartDate?: string;
    requestedEndDate?: string;
    category?: string;
    corpusVersion: string;
    retrievalTarget: "legacy" | "versioned";
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
    return `${count.toLocaleString("en-US")} ${count === 1 ? singular : pluralForm}`;
}

export function describeCoverageScope(coverage: ArchiveCoverage): string {
    const dateSpan =
        coverage.earliestEditionDate && coverage.latestEditionDate
            ? ` dated ${coverage.earliestEditionDate} through ${coverage.latestEditionDate}`
            : " in the requested date range";
    const category = coverage.category
        ? ` in the ${coverage.category} category`
        : "";
    return `${plural(coverage.editionCount, "indexed edition")}${dateSpan}, containing ${plural(coverage.articleCount, "searchable article")}${category}`;
}

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
- A positive historical claim still requires a cited article; coverage metadata never supports a source claim.
- If no relevant cited evidence was found, say that no matching evidence was found in the indexed scope. Never claim that the event or subject was absent from every newspaper page.
- For count or exhaustive questions, do not imply a database-wide exact result unless the cited evidence itself establishes that result.
- Do not lower confidence in a supported positive claim merely because editions outside the requested scope were not searched.`;
}

function noEvidenceAnswer(coverage: ArchiveCoverage): string {
    const scope = describeCoverageScope(coverage);
    if (coverage.intent === "absence") {
        return `No matching evidence was found in ${scope}. This does not establish that the subject was absent from every newspaper page; it only describes the indexed archive evidence.`;
    }
    return `I couldn't determine a complete answer from the indexed archive evidence. No matching evidence was found in ${scope}.`;
}

/**
 * Enforces the coverage wording after model output has already passed citation
 * allowlisting. With no verified citation, model prose is replaced by a safe,
 * deterministic no-evidence statement. With citations, the answer is retained
 * verbatim and receives only a scope note, so a supported positive claim keeps
 * its evidence-derived confidence.
 */
export function applyCoverageAnswerPolicy(
    answer: string,
    citationCount: number,
    coverage?: ArchiveCoverage,
): string {
    if (!coverage) return answer;
    if (citationCount === 0) return noEvidenceAnswer(coverage);

    const scope = describeCoverageScope(coverage);
    const note = coverage.intent === "absence"
        ? `Coverage note: the searchable scope contained ${scope}. That scope count does not itself prove absence; the claims above rely on the cited archive evidence.`
        : `Coverage note: the searchable scope contained ${scope}. The scope count is metadata; the claims above rely on the cited archive evidence.`;
    return `${answer.trim()}\n\n${note}`;
}
