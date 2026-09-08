/**
 * gemini-quota — recognising and describing Gemini quota exhaustion.
 *
 * Every model call in the pipeline can come back RESOURCE_EXHAUSTED, and
 * each one used to swallow it into its own fallback: the reformulator
 * returned the raw question, the reranker returned a flat score, the
 * generator returned a canned apology that was then persisted as an
 * answer. None of them told the reader to try again later.
 *
 * These helpers are deliberately pure and dependency-free so both the
 * request path and the embedding batch path can classify an error the
 * same way. `QuotaExhaustedError` itself stays in embeddings.ts, which
 * owns the retry loop and is the module tests mock.
 */

import type { AskErrorKind } from "@/src/types";

/**
 * Detect a Gemini RESOURCE_EXHAUSTED / 429 error across the various shapes
 * the SDK might surface (raw fetch error, JSON-stringified error body,
 * structured object). Returns true if any signal matches.
 */
export function isQuotaError(err: unknown): boolean {
  if (!err) return false;
  const e = err as {
    code?: number;
    status?: string;
    error?: { code?: number; status?: string };
  };
  if (e.code === 429) return true;
  if (e.status === "RESOURCE_EXHAUSTED") return true;
  if (e.error?.code === 429) return true;
  if (e.error?.status === "RESOURCE_EXHAUSTED") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /RESOURCE_EXHAUSTED|"code"\s*:\s*429|exceeded your current quota/i.test(msg);
}

/** Lower bound on a useful Retry-After, in seconds. */
const MIN_RETRY_AFTER_SEC = 5;
/** Upper bound: an hour. Anything longer is a daily quota, not a burst. */
const MAX_RETRY_AFTER_SEC = 3600;
/** Used when the error carries no usable delay of its own. */
const DEFAULT_RETRY_AFTER_SEC = 30;

/**
 * Pull a retry delay out of a quota error. Vertex reports it as a
 * `retryDelay: "23s"` field inside the error details, but the SDK
 * surfaces that in several shapes (nested object, JSON string in the
 * message), so this reads whichever it finds and clamps the result.
 */
export function retryAfterSecFromQuotaError(
  err: unknown,
  fallback = DEFAULT_RETRY_AFTER_SEC
): number {
  const haystacks: string[] = [];
  if (err instanceof Error) haystacks.push(err.message);
  const withCause = err as { cause?: unknown };
  if (withCause?.cause instanceof Error) haystacks.push(withCause.cause.message);
  try {
    haystacks.push(JSON.stringify(err));
  } catch {
    // Circular or otherwise unserialisable — the message forms still apply.
  }

  for (const text of haystacks) {
    if (!text) continue;
    const match =
      text.match(/retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i) ??
      text.match(/retry in (\d+(?:\.\d+)?)s/i);
    if (match) {
      const seconds = Math.ceil(Number(match[1]));
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.min(MAX_RETRY_AFTER_SEC, Math.max(MIN_RETRY_AFTER_SEC, seconds));
      }
    }
  }
  return Math.min(MAX_RETRY_AFTER_SEC, Math.max(MIN_RETRY_AFTER_SEC, fallback));
}

/**
 * A burst limit and a spent daily allowance both arrive as 429s, but they
 * mean different things to the reader: one is "in a moment", the other is
 * "tomorrow". A delay of ten minutes or more is a daily quota.
 */
export function kindForQuota(
  retryAfterSec: number
): Extract<AskErrorKind, "rate_limit" | "budget"> {
  return retryAfterSec >= 600 ? "budget" : "rate_limit";
}
