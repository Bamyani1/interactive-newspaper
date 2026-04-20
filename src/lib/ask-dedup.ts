/**
 * Concurrent request dedup for /api/ask.
 *
 * Coalesces two identical (ip, question, filters, sessionId) POSTs that
 * overlap in time so the second one piggybacks on the first instead of
 * running the full pipeline twice. `embedQuery` already has its own LRU
 * cache; this adds dedup for reformulator + rerank + answer-gen which
 * don't.
 */

import { NextResponse } from "next/server";

export const DEDUP_TTL_MS = 30_000;

export interface DedupExtracted {
    body: unknown;
    status: number;
    headers: Record<string, string>;
}

export interface DedupEntry {
    promise: Promise<NextResponse>;
    // The extraction is cached as a PROMISE rather than a settled value so
    // all concurrent waiters share a single response.clone().json() call.
    // Caching only the result (old impl) had a race window between the
    // second check and the cache write where two waiters could both call
    // response.clone() in parallel — fragile across runtimes.
    extractPromise?: Promise<DedupExtracted>;
}

export const inFlightAsk = new Map<string, DedupEntry>();

export function dedupKey(
    ip: string,
    question: string,
    filters: unknown,
    sessionId: string,
): string {
    // Simple non-cryptographic fingerprint; collisions don't matter because
    // they're scoped to the same IP and would only cause a missed dedup, not
    // wrong data. sessionId is part of the key because piggybackers skip the
    // pipeline body, so two different sessions sharing a dedup entry would
    // leave one of them without a conversation-store turn (follow-up history
    // lost) and with the first requester's sessionId baked into the SSE
    // done-event payload.
    let h = 0;
    const s = `${question}|${JSON.stringify(filters ?? {})}|${sessionId}`;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return `${ip}:${h}`;
}

export async function getOrExtract(entry: DedupEntry): Promise<DedupExtracted> {
    if (!entry.extractPromise) {
        entry.extractPromise = (async () => {
            const response = await entry.promise;
            const body = await response.clone().json();
            const headers: Record<string, string> = {};
            response.headers.forEach((value, key) => {
                headers[key] = value;
            });
            return { body, status: response.status, headers };
        })();
    }
    return entry.extractPromise;
}

export function freshResponseFromCached(data: DedupExtracted): NextResponse {
    return NextResponse.json(data.body, {
        status: data.status,
        headers: data.headers,
    });
}

// Test hook: clears the in-flight dedup map between tests so prior runs
// don't leak into new ones.
export function _clearAskDedupForTests(): void {
    inFlightAsk.clear();
}

// Test hook: exposes the dedup extract internals so unit tests can
// directly verify getOrExtract's exactly-once extraction guarantee with
// a mock response. Kept out of the public route surface via the `_`
// prefix convention.
export const _askDedupInternalsForTests = {
    getOrExtract,
    makeEntry: (response: NextResponse): DedupEntry => ({
        promise: Promise.resolve(response),
    }),
};
