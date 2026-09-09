/**
 * A fake SSE `Response` whose reader the test drives frame by frame.
 *
 * The hook's stream loop is a `while (true) { await reader.read() }`, and
 * the interesting lifecycle bugs all live in how it exits that loop: a
 * stream that ends without a terminal frame, an abort that lands between
 * two reads, an abort during the typewriter's final flush. A real
 * `Response` built from a string resolves every read immediately, so
 * there is no window in which to act. This helper keeps each read pending
 * until the test says otherwise.
 *
 * Not a `ReadableStream`: those queue their own microtasks and cannot
 * reject a pending read with an `AbortError` on demand, which is exactly
 * the behaviour under test.
 */

export interface ControlledSse {
  /** Passed to the fetch mock in place of a real Response. */
  response: Response;
  /** Push one `data: <json>` frame. */
  emit(event: unknown): void;
  /** Push raw bytes — for malformed-frame and split-frame cases. */
  emitRaw(text: string): void;
  /** End the stream cleanly (`done: true` on the next read). */
  close(): void;
  /** Reject the pending read with an AbortError, as a real abort does. */
  abort(): void;
}

export function makeSseResponse(): ControlledSse {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let closed = false;
  let aborted = false;
  let wake: (() => void) | null = null;

  const notify = () => {
    const resolve = wake;
    wake = null;
    resolve?.();
  };

  const read = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    for (;;) {
      if (aborted) throw new DOMException("The operation was aborted.", "AbortError");
      const next = chunks.shift();
      if (next) return { done: false, value: next };
      if (closed) return { done: true, value: undefined };
      // Exactly one reader is ever pending, so a single slot is enough.
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  };

  const response = {
    ok: true,
    status: 200,
    headers: {
      get: (key: string) => (key.toLowerCase() === "content-type" ? "text/event-stream" : null),
    },
    body: {
      getReader: () => ({
        read,
        cancel: () => {
          closed = true;
          notify();
          return Promise.resolve();
        },
      }),
    },
    json: () => Promise.reject(new Error("SSE response has no JSON body")),
  } as unknown as Response;

  return {
    response,
    emit(event: unknown) {
      chunks.push(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      notify();
    },
    emitRaw(text: string) {
      chunks.push(encoder.encode(text));
      notify();
    },
    close() {
      closed = true;
      notify();
    },
    abort() {
      aborted = true;
      notify();
    },
  };
}
