// Deterministic day-of-year rotation for archive example questions.
// Shared between the homepage Ask teaser (single pick) and the /ask
// empty-state landing (3-suggestion list) so both surfaces stay in
// sync and there's one source of truth for the pool.

export const QUESTION_POOL: readonly string[] = [
    "What was campus life like during Prohibition?",
    "How did OWU respond to the Vietnam War?",
    "Tell me about Homecoming in the 1970s.",
    "What did Bishop Kennedy say when he visited in 1960?",
    "How did the civil rights movement appear in the Transcript?",
    "When did women's varsity sports first show up?",
    "How did the paper cover the Kennedy assassination?",
    "What were the popular majors in 1955?",
    "Tell me about campus protests in 1968.",
    "What did the paper say about Earth Day 1970?",
    "What coverage did the 1969 moon landing get?",
    "What was the student dress code in the 1950s?",
];

// Monotonic day counter — year * 366 + day-of-year — so the index
// keeps advancing across year boundaries instead of resetting.
function dayIndex(date: Date): number {
    const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    return (
        date.getUTCFullYear() * 366 +
        Math.floor((date.getTime() - start) / 86_400_000)
    );
}

/** Single deterministic question for the given day — drives the homepage teaser. */
export function pickDailyQuestion(date: Date): string {
    return QUESTION_POOL[dayIndex(date) % QUESTION_POOL.length];
}

/**
 * Three day-of-year-rotated questions for the /ask landing suggestions.
 * Pass `exclude` to drop a specific question from the pool (used to
 * avoid repeating whatever question might be pinned elsewhere on that
 * surface).
 */
export function pickSuggestions(date: Date, exclude?: string): string[] {
    const idx = dayIndex(date);
    const pool = exclude
        ? QUESTION_POOL.filter((q) => q !== exclude)
        : QUESTION_POOL;
    return [0, 1, 2].map((i) => pool[(idx + i) % pool.length]);
}
