/**
 * Era Label Parser
 *
 * Converts human era labels emitted by the reformulator LLM (e.g. "1960s",
 * "early 1970s", "mid-century") into concrete ISO date ranges bounded by
 * the archive (1950-01-01 .. 2006-12-31). Pure function — no network, no
 * LLM, fully unit-testable.
 *
 * Returns null when the label is unparseable or falls entirely outside the
 * archive. Ranges that straddle the archive bounds are clamped.
 */

export interface Era {
    label: string;
    startDate: string; // ISO YYYY-MM-DD, inclusive
    endDate: string;   // ISO YYYY-MM-DD, inclusive
}

const ARCHIVE_START_YEAR = 1950;
const ARCHIVE_END_YEAR = 2006;

const DECADE_WORD_TO_START: Record<string, number> = {
    fifties: 1950,
    sixties: 1960,
    seventies: 1970,
    eighties: 1980,
    nineties: 1990,
};

// early/mid/late split: early = first 4 years, mid = 3, late = 3.
// Covers the full 10-year span with no gap.
const QUALIFIED_RANGES: Record<"early" | "mid" | "late", [number, number]> = {
    early: [0, 3],
    mid: [4, 6],
    late: [7, 9],
};

// "early 1970s", "late 60s", "mid nineties"
const QUALIFIED_DECADE_REGEX =
    /\b(early|mid|late)\s+(?:the\s+)?(?:(\d{4})'?s|(\d{2})'?s|(fifties|sixties|seventies|eighties|nineties))\b/;

// "1960s", "the 60s", "sixties"
const DECADE_REGEX =
    /\b(?:the\s+)?(?:(\d{4})'?s|(\d{2})'?s|(fifties|sixties|seventies|eighties|nineties))\b/;

// "1986", "the 2000", "the year 1965"
const SINGLE_YEAR_REGEX = /^(?:the\s+(?:year\s+)?)?(\d{4})$/;

function buildEra(
    label: string,
    startYear: number,
    endYear: number,
): Era | null {
    // Fully outside the archive on either side → unusable.
    if (endYear < ARCHIVE_START_YEAR || startYear > ARCHIVE_END_YEAR) {
        return null;
    }
    const clampedStart = Math.max(ARCHIVE_START_YEAR, startYear);
    const clampedEnd = Math.min(ARCHIVE_END_YEAR, endYear);
    return {
        label,
        startDate: `${clampedStart}-01-01`,
        endDate: `${clampedEnd}-12-31`,
    };
}

function resolveDecadeStart(
    fourDigit: string | undefined,
    twoDigit: string | undefined,
    word: string | undefined,
): number | null {
    if (fourDigit) {
        return Math.floor(parseInt(fourDigit, 10) / 10) * 10;
    }
    if (twoDigit) {
        const n = parseInt(twoDigit, 10);
        // Heuristic: 50-99 → 19xx, 00-49 → 20xx. Fits an archive that spans
        // 1950 through 2006 and nothing else.
        return n >= 50 ? 1900 + n : 2000 + n;
    }
    if (word) {
        return DECADE_WORD_TO_START[word] ?? null;
    }
    return null;
}

export function parseEraLabel(rawLabel: string): Era | null {
    const label = rawLabel.trim();
    if (!label) return null;

    const lower = label.toLowerCase();

    // Named periods first — they don't fit decade/year patterns.
    if (/\bmid[- ]century\b/.test(lower)) {
        // Conventional "mid-century" in American usage: ~1945-1965.
        // Clamped by buildEra to 1950-1964 for this archive.
        return buildEra(label, 1945, 1965);
    }
    if (/\bturn of the millennium\b/.test(lower)) {
        return buildEra(label, 1998, 2002);
    }

    // Qualified decade ("early 1970s") must be checked before bare decade
    // ("1970s") because the bare-decade regex would otherwise swallow the
    // numeric part and drop the qualifier.
    const qm = lower.match(QUALIFIED_DECADE_REGEX);
    if (qm) {
        const qualifier = qm[1] as "early" | "mid" | "late";
        const decadeStart = resolveDecadeStart(qm[2], qm[3], qm[4]);
        if (decadeStart === null) return null;
        const [offsetStart, offsetEnd] = QUALIFIED_RANGES[qualifier];
        return buildEra(label, decadeStart + offsetStart, decadeStart + offsetEnd);
    }

    const dm = lower.match(DECADE_REGEX);
    if (dm) {
        const decadeStart = resolveDecadeStart(dm[1], dm[2], dm[3]);
        if (decadeStart === null) return null;
        return buildEra(label, decadeStart, decadeStart + 9);
    }

    const ym = lower.match(SINGLE_YEAR_REGEX);
    if (ym) {
        const year = parseInt(ym[1], 10);
        return buildEra(label, year, year);
    }

    return null;
}

/**
 * Compute the fractional overlap between two era date ranges.
 * Returns a value in [0, 1] where 1 = identical ranges, 0 = no overlap.
 * Used by the reformulator to collapse near-duplicate eras.
 */
export function eraOverlapFraction(a: Era, b: Era): number {
    const aStart = Date.parse(a.startDate);
    const aEnd = Date.parse(a.endDate);
    const bStart = Date.parse(b.startDate);
    const bEnd = Date.parse(b.endDate);

    const overlapStart = Math.max(aStart, bStart);
    const overlapEnd = Math.min(aEnd, bEnd);
    if (overlapEnd <= overlapStart) return 0;

    const overlapDuration = overlapEnd - overlapStart;
    const shorterDuration = Math.min(aEnd - aStart, bEnd - bStart);
    if (shorterDuration <= 0) return 0;

    return overlapDuration / shorterDuration;
}
