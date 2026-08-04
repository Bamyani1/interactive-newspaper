/**
 * @vitest-environment node
 *
 * RAG golden regression suite
 *
 * Hits the REAL /api/ask pipeline (real Gemini, real Neon) with a
 * previously used development catalog of questions and asserts source/fact, security,
 * citation, mode, and deadline invariants. Historical count/confidence drift is
 * printed as telemetry, not treated as an accuracy oracle.
 *
 * Skipped unless RUN_RAG_GOLDEN=1 is set. Uses .env.local for credentials.
 *
 * Run with:
 *   RUN_RAG_GOLDEN=1 npx vitest run tests/api/rag-golden-questions.test.ts
 *
 * Only the rate limiter is mocked (to avoid tripping the 10/min per-IP cap
 * when the catalog has > 10 questions). Everything else is live.
 *
 * The node environment directive above is REQUIRED: the default jsdom
 * environment provides an AbortSignal polyfill that fails undici's
 * instanceof check when the Gemini SDK forwards the signal to fetch,
 * causing every request to throw TypeError before leaving the process.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

vi.mock("@/src/lib/rate-limit", () => ({
    createRateLimiter: () => () => ({ allowed: true, resetAt: Date.now() + 60000 }),
    getClientIp: () => "127.0.0.1",
}));

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadEnvLocal(): void {
    const envPath = resolve(__dirname, "../../.env.local");
    if (!existsSync(envPath)) return;
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
        const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
}

type Confidence = "low" | "medium" | "high";

interface GoldenQuestion {
    id: string;
    question: string;
    minCitations?: number;
    keywordsAny?: string[];
    forbiddenInAnswer?: string[];
    confidenceMin?: Confidence;
    confidenceMax?: Confidence;
    mode?: "text" | "visual";
    complexity?: "simple" | "complex";
    expectError?: boolean;
    expectStatus?: number;
    expectedSourceIdsAny?: string[];
    expectedSourceIdsAll?: string[];
    /** Every group must contribute at least one returned source ID. */
    expectedSourceIdGroupsAll?: string[][];
    expectedFactsAny?: string[][];
}

interface DevelopmentCatalog {
    schemaVersion: 2;
    datasetId: string;
    split: "development";
    provenance: string;
    questions: GoldenQuestion[];
}

const catalogPath = resolve(__dirname, "rag-golden-questions.json");
const developmentCatalog: DevelopmentCatalog = JSON.parse(
    readFileSync(catalogPath, "utf-8"),
);
if (developmentCatalog.split !== "development") {
    throw new Error("Previously used RAG questions must be labeled as development data.");
}
const catalog = developmentCatalog.questions;

const CONFIDENCE_RANK: Record<Confidence, number> = {
    low: 1,
    medium: 2,
    high: 3,
};

function makeRequest(question: string): NextRequest {
    return new NextRequest("http://localhost:3000/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
    });
}

type PostHandler = (typeof import("@/src/app/api/ask/route"))["POST"];

interface ObservedResult {
    id: string;
    status: number;
    confidence?: Confidence;
    citations: number;
    mode?: "text" | "visual";
    totalTimeMs?: number;
    retrievalTimeMs?: number;
    generationTimeMs?: number;
    method?: "hybrid" | "fts" | "vector";
    sourceIds?: string[];
}

describe.skipIf(!process.env.RUN_RAG_GOLDEN)("RAG golden regression suite", () => {
    let POST: PostHandler;
    const observed: ObservedResult[] = [];

    beforeAll(async () => {
        loadEnvLocal();
        if (!process.env.DATABASE_URL) {
            throw new Error(
                "Golden suite requires DATABASE_URL (via .env.local or shell env)",
            );
        }
        if (!process.env.GOOGLE_CLOUD_PROJECT) {
            throw new Error(
                "Golden suite requires GOOGLE_CLOUD_PROJECT and working ADC",
            );
        }
        const mod = await import("@/src/app/api/ask/route");
        POST = mod.POST;
    });

    afterAll(() => {
        if (observed.length === 0) return;
        const baselinePath = resolve(__dirname, "rag-golden-baseline.json");

        // Print the current-run snapshot regardless of regression state
        console.error("\n[rag-golden] current run snapshot:");
        for (const r of observed) {
            const timing = r.totalTimeMs !== undefined ? `${r.totalTimeMs}ms` : "-";
            const conf = r.confidence ?? "-";
            console.error(
                `[rag-golden]   ${r.id.padEnd(30)}  status=${r.status}  conf=${conf.padEnd(6)}  cit=${String(r.citations).padStart(2)}  mode=${(r.mode ?? "-").padEnd(6)}  method=${(r.method ?? "-").padEnd(6)}  ${timing}`,
            );
        }

        // Historical telemetry is informational only. Frozen source/fact
        // assertions in the catalog determine correctness; citation counts
        // and self-scored confidence are not a quality oracle.
        if (existsSync(baselinePath)) {
            try {
                const baselineRaw = JSON.parse(
                    readFileSync(baselinePath, "utf-8"),
                ) as { capturedAt?: string; results?: ObservedResult[] };
                const priorResults = baselineRaw.results ?? [];

                for (const curr of observed) {
                    const prior = priorResults.find((r) => r.id === curr.id);
                    if (!prior) continue;

                    if (curr.status !== prior.status) {
                        console.error(`[rag-golden] INFO  ${curr.id}: status ${prior.status} → ${curr.status}`);
                    }

                    // Confidence drop
                    if (curr.confidence && prior.confidence) {
                        const drop =
                            CONFIDENCE_RANK[prior.confidence] -
                            CONFIDENCE_RANK[curr.confidence];
                        if (drop >= 2) {
                            console.error(`[rag-golden] INFO  ${curr.id}: confidence ${prior.confidence} → ${curr.confidence}`);
                        } else if (drop === 1) {
                            console.error(
                                `[rag-golden] WARN  ${curr.id}: confidence ${prior.confidence} → ${curr.confidence} (drift 1 level)`,
                            );
                        }
                    }

                    // Citation count drop
                    if (prior.citations >= 2) {
                        if (curr.citations * 2 < prior.citations) {
                            console.error(`[rag-golden] INFO  ${curr.id}: citations ${prior.citations} → ${curr.citations}`);
                        } else if (curr.citations < prior.citations) {
                            console.error(
                                `[rag-golden] WARN  ${curr.id}: citations ${prior.citations} → ${curr.citations}`,
                            );
                        }
                    }

                    // Method change (hybrid → vector fallback) is a warning
                    if (
                        curr.method &&
                        prior.method &&
                        curr.method !== prior.method
                    ) {
                        console.error(
                            `[rag-golden] WARN  ${curr.id}: method ${prior.method} → ${curr.method}`,
                        );
                    }
                }
            } catch (err) {
                console.error(
                    `[rag-golden] failed to read baseline for comparison: ${err}`,
                );
            }
        }
    });

    for (const q of catalog) {
        const title = `${q.id}: ${q.question.trim().slice(0, 60).replace(/\s+/g, " ")}`;
        it(
            title,
            async () => {
                const response = await POST(makeRequest(q.question));
                const body = await response.json();

                // Record observed shape for the read-only comparison report.
                observed.push({
                    id: q.id,
                    status: response.status,
                    confidence: body.confidence,
                    citations: Array.isArray(body.citations) ? body.citations.length : 0,
                    mode: body.mode,
                    totalTimeMs: body.meta?.totalTimeMs,
                    retrievalTimeMs: body.meta?.retrievalTimeMs,
                    generationTimeMs: body.meta?.generationTimeMs,
                    method: body.meta?.method,
                    sourceIds: Array.isArray(body.sourceArticles)
                        ? body.sourceArticles.map((source: { id: string }) => source.id)
                        : [],
                });

                if (q.expectError) {
                    expect(response.status).toBe(q.expectStatus ?? 400);
                    expect(body.error).toBeDefined();
                    return;
                }

                // Happy-path assertions
                expect(response.status).toBe(200);
                expect(body.error).toBeUndefined();
                expect(typeof body.answer).toBe("string");
                expect(body.answer.length).toBeGreaterThan(0);
                expect(Array.isArray(body.citations)).toBe(true);

                if (q.minCitations !== undefined) {
                    expect(body.citations.length).toBeGreaterThanOrEqual(q.minCitations);
                }

                if (q.keywordsAny && q.keywordsAny.length > 0) {
                    const answerLower = body.answer.toLowerCase();
                    const found = q.keywordsAny.some((kw) =>
                        answerLower.includes(kw.toLowerCase()),
                    );
                    expect(
                        found,
                        `Expected answer to contain any of [${q.keywordsAny.join(", ")}]; got: ${body.answer.slice(0, 200)}`,
                    ).toBe(true);
                }

                // Prompt-injection guard: the answer must NOT contain any
                // of these substrings (case-insensitive). Used for
                // adversarial questions that try to override the system
                // prompt or exfiltrate it.
                if (q.forbiddenInAnswer && q.forbiddenInAnswer.length > 0) {
                    const answerLower = body.answer.toLowerCase();
                    for (const forbidden of q.forbiddenInAnswer) {
                        expect(
                            answerLower.includes(forbidden.toLowerCase()),
                            `Expected answer to NOT contain "${forbidden}" (prompt injection failure); got: ${body.answer.slice(0, 300)}`,
                        ).toBe(false);
                    }
                }

                if (q.confidenceMin) {
                    const got = CONFIDENCE_RANK[body.confidence as Confidence];
                    const floor = CONFIDENCE_RANK[q.confidenceMin];
                    expect(
                        got,
                        `confidence "${body.confidence}" below floor "${q.confidenceMin}"`,
                    ).toBeGreaterThanOrEqual(floor);
                }

                if (q.confidenceMax) {
                    const got = CONFIDENCE_RANK[body.confidence as Confidence];
                    const ceiling = CONFIDENCE_RANK[q.confidenceMax];
                    expect(
                        got,
                        `confidence "${body.confidence}" above ceiling "${q.confidenceMax}"`,
                    ).toBeLessThanOrEqual(ceiling);
                }

                if (q.mode) {
                    expect(body.mode).toBe(q.mode);
                }

                if (q.complexity) {
                    expect(body.meta?.complexity).toBe(q.complexity);
                }

                const sourceIds = new Set(
                    Array.isArray(body.sourceArticles)
                        ? body.sourceArticles.map((source: { id: string }) => source.id)
                        : [],
                );
                if (q.expectedSourceIdsAny?.length) {
                    expect(
                        q.expectedSourceIdsAny.some((id) => sourceIds.has(id)),
                        `Expected at least one frozen relevant source; got ${[...sourceIds].join(", ")}`,
                    ).toBe(true);
                }
                for (const id of q.expectedSourceIdsAll ?? []) {
                    expect(sourceIds.has(id), `Missing frozen relevant source ${id}`).toBe(true);
                }
                for (const group of q.expectedSourceIdGroupsAll ?? []) {
                    expect(
                        group.some((id) => sourceIds.has(id)),
                        `Expected one frozen source from group [${group.join(", ")}]; got ${[...sourceIds].join(", ")}`,
                    ).toBe(true);
                }
                const answerLower = body.answer.toLowerCase();
                for (const aliases of q.expectedFactsAny ?? []) {
                    expect(
                        aliases.some((fact) => answerLower.includes(fact.toLowerCase())),
                        `Expected answer fact represented by one of [${aliases.join(", ")}]`,
                    ).toBe(true);
                }

                expect(body.meta?.totalTimeMs).toBeLessThan(30000);
            },
            60000,
        );
    }
});
