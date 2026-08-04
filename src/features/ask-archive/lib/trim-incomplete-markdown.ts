/**
 * Display-layer cleanup for streaming answers: hides markdown constructs
 * that have started arriving but aren't complete yet, so the reader never
 * sees raw syntax (a half-typed image URL, a dangling "[Source"), and
 * in-progress emphasis renders as plain text instead of literal asterisks.
 *
 * Applied only while a turn is streaming — the reducer keeps the full
 * text, and the done event's answer renders untrimmed.
 */

// Trailing constructs held back entirely until they close. Order matters:
// an image embed is checked before a plain link so `![` isn't split at
// its inner `[`.
const INCOMPLETE_TAIL_RES = [
    /!\[[^\]]*(?:\]\([^)]*)?$/, // ![alt  or  ![alt](partial-url
    /\[[^\]]*(?:\]\([^)]*)?$/, // [Sour  or  [label](partial-url
    /!$/, // lone "!" that may become "!["
];

export function trimIncompleteMarkdown(text: string): string {
    let out = text;

    for (const re of INCOMPLETE_TAIL_RES) {
        const match = re.exec(out);
        if (match) {
            out = out.slice(0, match.index);
            break; // tail constructs are mutually exclusive
        }
    }

    // A bare heading marker with no text yet renders literally as "##".
    out = out.replace(/(^|\n)#{1,6} ?$/, "$1");

    // Unclosed bold: drop the trailing "**" marker but keep the words —
    // they read as plain text now and restyle to bold when it closes,
    // which is calmer than the phrase popping in all at once.
    const boldMarkers = out.match(/\*\*/g);
    if (boldMarkers && boldMarkers.length % 2 === 1) {
        const cut = out.lastIndexOf("**");
        out = out.slice(0, cut) + out.slice(cut + 2);
    }
    // A trailing lone "*" may be about to become "**".
    out = out.replace(/\*$/, "");

    return out;
}
