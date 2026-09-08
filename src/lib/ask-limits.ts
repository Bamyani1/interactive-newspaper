/**
 * Limits the composer and the route must agree on.
 *
 * They did not: the textarea had no `maxLength`, so a long paste was
 * accepted, sent, rejected with a 400, and rendered as an error turn — the
 * reader discovered the limit by tripping it, with their question already
 * gone from the box.
 */

/** Longest question `POST /api/ask` accepts, in characters. */
export const MAX_QUESTION_LENGTH = 1000;

/**
 * Show the remaining-characters counter from here on. Early enough that a
 * reader approaching the limit sees it coming, late enough that it is not
 * nagging at them through an ordinary question.
 */
export const QUESTION_COUNTER_THRESHOLD = 900;
