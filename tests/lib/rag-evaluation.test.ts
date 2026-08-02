import { afterEach, describe, expect, it, vi } from "vitest";
import {
    getRagEvaluationConfig,
    isRagEvaluationMode,
    RAG_EVALUATION_MAX_SPEND_USD,
} from "@/src/lib/rag-evaluation";

describe("RAG evaluation configuration", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("is disabled unless explicitly selected", () => {
        expect(isRagEvaluationMode({})).toBe(false);
        expect(getRagEvaluationConfig({})).toMatchObject({
            enabled: false,
            runId: null,
        });
    });

    it("requires a run and frozen corpus identity", () => {
        expect(() => getRagEvaluationConfig({ RAG_EVALUATION_MODE: "1" })).toThrow(
            /RAG_EVALUATION_RUN_ID/,
        );
        expect(() =>
            getRagEvaluationConfig({
                RAG_EVALUATION_MODE: "1",
                RAG_EVALUATION_RUN_ID: "run-1",
            }),
        ).toThrow(/RAG_CORPUS_VERSION/);
    });

    it("accepts a capped, explicitly identified run", () => {
        expect(
            getRagEvaluationConfig({
                RAG_EVALUATION_MODE: "true",
                RAG_EVALUATION_RUN_ID: "holdout-v1-run-001",
                RAG_CORPUS_VERSION: "legacy-8b8207373510d69e",
                RAG_EVALUATION_SPEND_CAP_USD: "2.50",
            }),
        ).toEqual({
            enabled: true,
            runId: "holdout-v1-run-001",
            corpusVersion: "legacy-8b8207373510d69e",
            spendCapUsd: 2.5,
        });
    });

    it("never allows configuration above the approved cap", () => {
        expect(RAG_EVALUATION_MAX_SPEND_USD).toBe(10);
        expect(() =>
            getRagEvaluationConfig({
                RAG_EVALUATION_MODE: "1",
                RAG_EVALUATION_RUN_ID: "run-1",
                RAG_CORPUS_VERSION: "legacy-test",
                RAG_EVALUATION_SPEND_CAP_USD: "10.01",
            }),
        ).toThrow(/no more than \$10/);
    });

    it("rejects ambiguous flag values", () => {
        expect(() => isRagEvaluationMode({ RAG_EVALUATION_MODE: "yes" })).toThrow(
            /Invalid RAG_EVALUATION_MODE/,
        );
    });
});
