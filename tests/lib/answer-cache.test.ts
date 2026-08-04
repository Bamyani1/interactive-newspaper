import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    getCachedAnswer,
    setCachedAnswer,
    clearAnswerCache,
} from "@/src/lib/answer-cache";
import type { AskResponse } from "@/src/types";

function makeResponse(overrides: Partial<AskResponse> = {}): AskResponse {
    return {
        question: "sample question",
        answer: "sample answer",
        citations: [],
        confidence: "high",
        mode: "text",
        requestId: "req-1",
        sourceArticles: [],
        meta: {
            retrievalTimeMs: 10,
            generationTimeMs: 20,
            totalTimeMs: 30,
            articlesSearched: 5,
            method: "hybrid",
        },
        ...overrides,
    };
}

describe("answer-cache", () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        clearAnswerCache();
    });

    it("hit returns cached response", () => {
        const response = makeResponse({ answer: "cached answer" });
        setCachedAnswer("what happened?", {}, response);
        const cached = getCachedAnswer("what happened?", {});
        expect(cached).not.toBeNull();
        expect(cached!.answer).toBe("cached answer");
    });

    it("miss returns null", () => {
        expect(getCachedAnswer("never asked", {})).toBeNull();
    });

    it("normalizes key across case and whitespace", () => {
        const response = makeResponse();
        setCachedAnswer("Campus Life In 1965", {}, response);
        expect(getCachedAnswer("campus life in 1965", {})).not.toBeNull();
        expect(getCachedAnswer("  CAMPUS LIFE IN 1965  ", {})).not.toBeNull();
        expect(getCachedAnswer("CAMPUS life IN 1965", {})).not.toBeNull();
    });

    it("expired entry is treated as miss", () => {
        vi.useFakeTimers();
        try {
            const response = makeResponse();
            setCachedAnswer("expiring question", {}, response);
            expect(getCachedAnswer("expiring question", {})).not.toBeNull();
            // Advance past 1 hour TTL
            vi.advanceTimersByTime(60 * 60 * 1000 + 1);
            expect(getCachedAnswer("expiring question", {})).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("evicts oldest when over 200 entries", () => {
        // Fill cache to 200
        for (let i = 0; i < 200; i++) {
            setCachedAnswer(`q${i}`, {}, makeResponse({ answer: `a${i}` }));
        }
        // First entry still there
        expect(getCachedAnswer("q0", {})).not.toBeNull();
        // Note: getCachedAnswer promotes q0 to MRU
        // Add 201st entry — this should evict the now-oldest (q1)
        setCachedAnswer("q200", {}, makeResponse({ answer: "a200" }));
        expect(getCachedAnswer("q1", {})).toBeNull();
        expect(getCachedAnswer("q200", {})).not.toBeNull();
        expect(getCachedAnswer("q0", {})).not.toBeNull();
    });

    it("does not cache low-confidence answers", () => {
        const response = makeResponse({ confidence: "low" });
        setCachedAnswer("weak question", {}, response);
        expect(getCachedAnswer("weak question", {})).toBeNull();
    });

    it("does not cache agent-path (complex) answers", () => {
        const response = makeResponse({
            meta: {
                retrievalTimeMs: 10,
                generationTimeMs: 20,
                totalTimeMs: 30,
                articlesSearched: 5,
                method: "hybrid",
                complexity: "complex",
            },
        });
        setCachedAnswer("complex question", {}, response);
        expect(getCachedAnswer("complex question", {})).toBeNull();
    });

    it("bypasses reads and writes during an isolated evaluation", () => {
        const response = makeResponse({ answer: "production cache" });
        setCachedAnswer("same question", {}, response);
        expect(getCachedAnswer("same question", {})).not.toBeNull();

        vi.stubEnv("RAG_EVALUATION_MODE", "1");
        expect(getCachedAnswer("same question", {})).toBeNull();
        setCachedAnswer(
            "evaluation-only question",
            {},
            makeResponse({ answer: "must not persist" }),
        );

        vi.stubEnv("RAG_EVALUATION_MODE", "0");
        expect(getCachedAnswer("same question", {})?.answer).toBe("production cache");
        expect(getCachedAnswer("evaluation-only question", {})).toBeNull();
    });

    it("different filters produce different keys", () => {
        const r1 = makeResponse({ answer: "no filter" });
        const r2 = makeResponse({ answer: "with filter" });
        setCachedAnswer("same question", {}, r1);
        setCachedAnswer("same question", { category: "News" }, r2);
        expect(getCachedAnswer("same question", {})!.answer).toBe("no filter");
        expect(getCachedAnswer("same question", { category: "News" })!.answer).toBe("with filter");
    });

    it("does not reuse answers across retrieval index builds", () => {
        vi.stubEnv("RAG_RETRIEVAL_MODE", "versioned");
        vi.stubEnv("RAG_ACTIVE_INDEX_BUILD_ID", "build-a");
        setCachedAnswer("same question", {}, makeResponse({ answer: "build a" }));

        vi.stubEnv("RAG_ACTIVE_INDEX_BUILD_ID", "build-b");
        expect(getCachedAnswer("same question", {})).toBeNull();
    });

    it("MRU promotion: accessed entries survive eviction", () => {
        for (let i = 0; i < 200; i++) {
            setCachedAnswer(`q${i}`, {}, makeResponse());
        }
        // Access q5 to promote it to MRU
        expect(getCachedAnswer("q5", {})).not.toBeNull();
        // Add many new entries to force eviction
        for (let i = 200; i < 210; i++) {
            setCachedAnswer(`q${i}`, {}, makeResponse());
        }
        // q5 should have survived eviction since it was promoted
        expect(getCachedAnswer("q5", {})).not.toBeNull();
    });
});
