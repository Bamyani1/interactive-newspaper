/**
 * The database timeout race, driver-free.
 *
 * Extracted from db.ts so modules that must not import it can still bound
 * a query: db.ts builds its Neon client at module load, which throws
 * without DATABASE_URL and pulls the driver into every importer.
 * conversation-store, cost-tracker, rate-limit and the ask route all need
 * the race without that. db.ts re-exports both symbols, so every existing
 * `instanceof DbTimeoutError` check and test mock keeps working.
 */

/**
 * Thrown when a database operation exceeds its timeout budget. Neon HTTP
 * requests receive the same AbortSignal, so a timeout cancels the
 * underlying fetch instead of leaving an orphaned database request running.
 */
export class DbTimeoutError extends Error {
  constructor(
    public readonly op: string,
    public readonly timeoutMs: number
  ) {
    super(`Database operation timed out: ${op} after ${timeoutMs}ms`);
    this.name = "DbTimeoutError";
  }
}

export async function runWithDbTimeout<T>(
  op: string,
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  outerSignal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  const signal = outerSignal
    ? AbortSignal.any([outerSignal, controller.signal])
    : controller.signal;
  let rejectOnAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectOnAbort = () => reject(new DbTimeoutError(op, timeoutMs));
    signal.addEventListener("abort", rejectOnAbort, { once: true });
  });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (signal.aborted) throw new DbTimeoutError(op, timeoutMs);
    // Neon receives the signal and normally rejects its fetch itself. The
    // race is still required so a driver regression or test double that
    // ignores AbortSignal can never pin a request past its deadline.
    return await Promise.race([operation(signal), aborted]);
  } catch (error) {
    if (signal.aborted) throw new DbTimeoutError(op, timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
    if (rejectOnAbort) signal.removeEventListener("abort", rejectOnAbort);
  }
}
