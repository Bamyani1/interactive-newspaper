/**
 * @vitest-environment node
 *
 * RAG golden regression suite
 *
 * Hits the REAL /api/ask pipeline (real Gemini, real Neon) with a
 * hand-curated catalog of questions and asserts basic accuracy invariants:
 * citations present, keywords appear in answer, confidence floor/ceiling,
 * mode detection, response time under 30s.
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
import { readFileSync, existsSync, writeFileSync } from "fs";
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
    citationsSpanMinDistinctDecades?: number;
    keywordsAny?: string[];
    forbiddenInAnswer?: string[];
    confidenceMin?: Confidence;
    confidenceMax?: Confidence;
    mode?: "text" | "visual";
    expectError?: boolean;
    expectStatus?: number;
}

const catalogPath = resolve(__dirname, "rag-golden-questions.json");
const catalog: GoldenQuestion[] = JSON.parse(readFileSync(catalogPath, "utf-8"));

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
    citationEditionDates?: string[];
    mode?: "text" | "visual";
    totalTimeMs?: number;
    retrievalTimeMs?: number;
    generationTimeMs?: number;
    method?: "hybrid" | "vector";
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
        if (!process.env.GOOGLE_API_KEY) {
            throw new Error(
                "Golden suite requires GOOGLE_API_KEY (via .env.local or shell env)",
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

        // Drift detection: compare current run against prior baseline.
        // Confidence drop >= 2 levels OR citations halved OR status change
        // is a hard regression — fails the suite AND preserves the prior
        // baseline for investigation. Smaller drops are warnings only.
        const regressions: string[] = [];
        if (existsSync(baselinePath)) {
            try {
                const baselineRaw = JSON.parse(
                    readFileSync(baselinePath, "utf-8"),
                ) as { capturedAt?: string; results?: ObservedResult[] };
                const priorResults = baselineRaw.results ?? [];

                for (const curr of observed) {
                    const prior = priorResults.find((r) => r.id === curr.id);
                    if (!prior) continue;

                    // Status code change is always a regression
                    if (curr.status !== prior.status) {
                        regressions.push(
                            `${curr.id}: status ${prior.status} → ${curr.status}`,
                        );
                        continue; // skip further checks for this one
                    }

                    // Confidence drop
                    if (curr.confidence && prior.confidence) {
                        const drop =
                            CONFIDENCE_RANK[prior.confidence] -
                            CONFIDENCE_RANK[curr.confidence];
                        if (drop >= 2) {
                            regressions.push(
                                `${curr.id}: confidence ${prior.confidence} → ${curr.confidence} (dropped ${drop} levels)`,
                            );
                        } else if (drop === 1) {
                            console.error(
                                `[rag-golden] WARN  ${curr.id}: confidence ${prior.confidence} → ${curr.confidence} (drift 1 level)`,
                            );
                        }
                    }

                    // Citation count drop
                    if (prior.citations >= 2) {
                        if (curr.citations * 2 < prior.citations) {
                            regressions.push(
                                `${curr.id}: citations ${prior.citations} → ${curr.citations} (halved)`,
                            );
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
        } else {
            console.error(
                `[rag-golden] no prior baseline at ${baselinePath} — this run becomes the first baseline`,
            );
        }

        if (regressions.length > 0) {
            console.error(
                `\n[rag-golden] REGRESSIONS DETECTED vs prior baseline:\n  ${regressions.join("\n  ")}\n\nNOT writing new baseline — delete ${baselinePath} manually once the cause is fixed.`,
            );
            throw new Error(
                `golden suite detected ${regressions.length} regression(s) vs baseline`,
            );
        }

        // No regressions → update baseline
        writeFileSync(
            baselinePath,
            JSON.stringify(
                { capturedAt: new Date().toISOString(), results: observed },
                null,
                2,
            ),
            "utf-8",
        );
        console.error(`[rag-golden] wrote ${baselinePath}`);
    });

    for (const q of catalog) {
        const title = `${q.id}: ${q.question.trim().slice(0, 60).replace(/\s+/g, " ")}`;
        it(
            title,
            async () => {
                const response = await POST(makeRequest(q.question));
                const body = await response.json();

                // Record observed shape for baseline snapshot (afterAll writes it)
                const citationEditionDates = Array.isArray(body.citations)
                    ? (body.citations as Array<{ editionDate: string }>).map((c) => c.editionDate)
                    : [];
                observed.push({
                    id: q.id,
                    status: response.status,
                    confidence: body.confidence,
                    citations: citationEditionDates.length,
                    citationEditionDates,
                    mode: body.mode,
                    totalTimeMs: body.meta?.totalTimeMs,
                    retrievalTimeMs: body.meta?.retrievalTimeMs,
                    generationTimeMs: body.meta?.generationTimeMs,
                    method: body.meta?.method,
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

                if (q.citationsSpanMinDistinctDecades !== undefined) {
                    const decades = new Set(
                        citationEditionDates.map(
                            (d) => d.slice(0, 3) + "0s",
                        ),
                    );
                    expect(
                        decades.size,
                        `Expected citations to span ≥${q.citationsSpanMinDistinctDecades} distinct decades; got ${Array.from(decades).join(", ")}`,
                    ).toBeGreaterThanOrEqual(q.citationsSpanMinDistinctDecades);
                }

                if (q.mode) {
                    expect(body.mode).toBe(q.mode);
                }

                expect(body.meta?.totalTimeMs).toBeLessThan(30000);
            },
            60000,
        );
    }
});
