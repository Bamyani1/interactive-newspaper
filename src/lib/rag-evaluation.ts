const DEFAULT_EVALUATION_SPEND_CAP_USD = 10;
const MAX_EVALUATION_SPEND_CAP_USD = 10;

export interface RagEvaluationConfig {
    enabled: boolean;
    runId: string | null;
    corpusVersion: string | null;
    spendCapUsd: number;
}

function parseBooleanFlag(value: string | undefined): boolean {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || normalized === "0" || normalized === "false") return false;
    if (normalized === "1" || normalized === "true") return true;
    throw new Error(
        `Invalid RAG_EVALUATION_MODE=${JSON.stringify(value)}; expected 1, 0, true, or false.`,
    );
}

export function isRagEvaluationMode(
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    return parseBooleanFlag(env.RAG_EVALUATION_MODE);
}

/**
 * Resolve the strict live-evaluation configuration.
 *
 * Evaluation is deliberately fail-closed: a run must have a filesystem-safe
 * identity, a frozen corpus version, and a spend ceiling no greater than the
 * approved $10 maximum. This config never enables evaluation implicitly.
 */
export function getRagEvaluationConfig(
    env: NodeJS.ProcessEnv = process.env,
): RagEvaluationConfig {
    const enabled = isRagEvaluationMode(env);
    if (!enabled) {
        return {
            enabled: false,
            runId: null,
            corpusVersion: env.RAG_CORPUS_VERSION?.trim() || null,
            spendCapUsd: DEFAULT_EVALUATION_SPEND_CAP_USD,
        };
    }

    const runId = env.RAG_EVALUATION_RUN_ID?.trim() || "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(runId)) {
        throw new Error(
            "RAG_EVALUATION_RUN_ID is required in evaluation mode and must be filesystem-safe.",
        );
    }
    const corpusVersion = env.RAG_CORPUS_VERSION?.trim() || "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(corpusVersion)) {
        throw new Error(
            "RAG_CORPUS_VERSION is required in evaluation mode and must identify a frozen corpus.",
        );
    }
    const rawCap = env.RAG_EVALUATION_SPEND_CAP_USD?.trim();
    const spendCapUsd = rawCap
        ? Number(rawCap)
        : DEFAULT_EVALUATION_SPEND_CAP_USD;
    if (
        !Number.isFinite(spendCapUsd) ||
        spendCapUsd <= 0 ||
        spendCapUsd > MAX_EVALUATION_SPEND_CAP_USD
    ) {
        throw new Error(
            `RAG_EVALUATION_SPEND_CAP_USD must be greater than 0 and no more than $${MAX_EVALUATION_SPEND_CAP_USD}.`,
        );
    }

    return { enabled, runId, corpusVersion, spendCapUsd };
}

export const RAG_EVALUATION_MAX_SPEND_USD = MAX_EVALUATION_SPEND_CAP_USD;
