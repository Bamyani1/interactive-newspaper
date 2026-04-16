/**
 * Answer Cache
 *
 * In-memory LRU cache for generated pipeline-path answers. Eliminates the
 * re-generation cost for repeat questions within the TTL window.
 *
 * Skipped for agent-path (complexity=complex) and low-confidence answers —
 * both are contextual or unreliable enough that caching isn't a win.
 *
 * Note: Vercel serverless may run multiple function instances; cache is
 * per-instance. Hit rate depends on routing. No correctness concern.
 */

import { createHash } from "crypto";
import type { AskResponse } from "@/src/types";

const MAX_ENTRIES = 200;
const TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
    response: AskResponse;
    ts: number;
}

const cache = new Map<string, CacheEntry>();

function makeKey(question: string, filters?: unknown): string {
    const normalized = question.trim().toLowerCase();
    const filtersJson = JSON.stringify(filters ?? {});
    return createHash("sha256").update(`${normalized}|${filtersJson}`).digest("hex");
}

export function getCachedAnswer(
    question: string,
    filters?: unknown,
): AskResponse | null {
    const key = makeKey(question, filters);
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > TTL_MS) {
        cache.delete(key);
        return null;
    }
    // Promote to MRU
    cache.delete(key);
    cache.set(key, entry);
    return entry.response;
}

export function setCachedAnswer(
    question: string,
    filters: unknown,
    response: AskResponse,
): void {
    if (response.confidence === "low") return;
    if (response.meta?.complexity === "complex") return;

    const key = makeKey(question, filters);
    if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { response, ts: Date.now() });
}

export function clearAnswerCache(): void {
    cache.clear();
}
