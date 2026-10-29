import { runWithDbTimeout } from "@/src/lib/db-timeout";
import { setServingPointer, type ServingPointer } from "@/src/lib/rag-index-config";
import { createSql } from "@/src/lib/sql";

// A switch reaches every server instance within this window.
const POINTER_TTL_MS = 30_000;
// After a failed read, keep the last pointer and try again this soon.
const RETRY_AFTER_ERROR_MS = 5_000;
const POINTER_READ_TIMEOUT_MS = 3_000;

interface LoaderDeps {
  env: NodeJS.ProcessEnv;
  now: () => number;
  /** The pointer row, or null when there is none. Throws when it can't tell. */
  read: () => Promise<ServingPointer | null>;
}

/**
 * Loads rag_serving_pointer into rag-index-config's cache. It reads only when
 * the config could use it: no RAG_ACTIVE_INDEX_BUILD_ID override. Concurrent callers share one read; a
 * failed read keeps the last good pointer.
 */
export function createServingPointerLoader(deps: LoaderDeps): () => Promise<void> {
  let freshUntil = 0;
  let inflight: Promise<void> | null = null;

  return async function loadServingPointer() {
    if (deps.env.RAG_ACTIVE_INDEX_BUILD_ID?.trim()) return;
    if (deps.now() < freshUntil) return;
    inflight ??= deps
      .read()
      .then((pointer) => {
        setServingPointer(pointer);
        freshUntil = deps.now() + POINTER_TTL_MS;
      })
      .catch((error: unknown) => {
        freshUntil = deps.now() + RETRY_AFTER_ERROR_MS;
        console.warn(
          JSON.stringify({
            level: "warn",
            msg: "rag_serving_pointer read failed; keeping the last pointer",
            error: error instanceof Error ? error.message : String(error),
          })
        );
      })
      .finally(() => {
        inflight = null;
      });
    await inflight;
  };
}

let sql: ReturnType<typeof createSql> | null = null;

async function readPointerRow(): Promise<ServingPointer | null> {
  sql ??= createSql(process.env.DATABASE_URL!);
  const db = sql;
  const rows = await runWithDbTimeout(
    "loadServingPointer",
    (signal) =>
      db.query("SELECT index_build_id, corpus_version FROM rag_serving_pointer WHERE id = 1", [], {
        fetchOptions: { signal },
      }) as Promise<Record<string, unknown>[]>,
    POINTER_READ_TIMEOUT_MS
  );
  const row = rows[0];
  return row
    ? { indexBuildId: String(row.index_build_id), corpusVersion: String(row.corpus_version) }
    : null;
}

export const loadServingPointer = createServingPointerLoader({
  env: process.env,
  now: Date.now,
  read: readPointerRow,
});
