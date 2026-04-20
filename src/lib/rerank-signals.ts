/**
 * Retrieval-shape telemetry for /api/ask.
 *
 * These signals used to gate a reranker-bypass optimization that never
 * fired in practice (see the "Delete rerank bypass, keep telemetry"
 * investigation — all 11 golden cases had avgVectorDist > 0.20, and no
 * clean threshold separated legitimate good retrieval from prompt-
 * injection payloads).
 *
 * Today they exist purely as production observability: operators can
 * grep stderr for `stage: "retrieval-signals"` to see retrieval quality
 * over time, and any future optimization built on top of these numbers
 * can be designed from real multi-run data rather than n=1 theory.
 */

import type { RetrievedArticle } from "@/src/lib/db";

export interface RerankSignals {
    avgVectorDist: number | null;
    vectorCount: number;
    bothCount: number;
    ftsOnlyCount: number;
    vectorOnlyCount: number;
    topThreeBothCount: number;
    totalArticles: number;
}

export function computeRerankSignals(articles: RetrievedArticle[]): RerankSignals {
    const vectorArticles = articles.filter((a) => a.distance !== null);
    const avgVectorDist =
        vectorArticles.length > 0
            ? vectorArticles.reduce((sum, a) => sum + (a.distance ?? 0), 0) /
              vectorArticles.length
            : null;
    const bothCount = articles.filter((a) => a.source === "both").length;
    const ftsOnlyCount = articles.filter((a) => a.source === "fts").length;
    const vectorOnlyCount = articles.filter((a) => a.source === "vector").length;
    const topThreeBothCount = articles
        .slice(0, 3)
        .filter((a) => a.source === "both").length;

    return {
        avgVectorDist,
        vectorCount: vectorArticles.length,
        bothCount,
        ftsOnlyCount,
        vectorOnlyCount,
        topThreeBothCount,
        totalArticles: articles.length,
    };
}

/**
 * Emit retrieval-signals telemetry for an /api/ask request. Writes at
 * warn level because the project's eslint `no-console` rule restricts to
 * {error, warn}; this is semantically info-level.
 */
export function logRerankSignals(
    requestId: string,
    signals: RerankSignals,
    mode: "text" | "visual",
    pathTag: "streaming" | "default",
): void {
    console.warn(
        JSON.stringify({
            level: "info",
            route: "/api/ask",
            requestId,
            stage: "retrieval-signals",
            msg: `retrieval signals (${pathTag})`,
            avgVectorDist:
                signals.avgVectorDist !== null
                    ? Number(signals.avgVectorDist.toFixed(4))
                    : null,
            vectorCount: signals.vectorCount,
            bothCount: signals.bothCount,
            ftsOnlyCount: signals.ftsOnlyCount,
            vectorOnlyCount: signals.vectorOnlyCount,
            topThreeBothCount: signals.topThreeBothCount,
            totalArticles: signals.totalArticles,
            mode,
        }),
    );
}

// Test hook: exposes the signals helper so unit tests can assert the
// telemetry shape directly without standing up a full route-level fetch.
export const _computeRerankSignalsForTests = computeRerankSignals;
