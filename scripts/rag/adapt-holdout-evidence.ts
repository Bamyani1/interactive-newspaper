/**
 * Adapt the frozen holdout catalog (evaluation/rag/holdout/rag-holdout-v1.json)
 * into the scorer's evidence shape (scripts/rag/score-eval.ts).
 *
 * Mapping semantics (documented so the adaptation is auditable):
 * - acceptableEvidenceGroups are OR-alternatives ("the answer may ground in
 *   group A or group B"). The scorer's group rule is ">=1 hit in top-8 per
 *   group", so alternatives are collapsed into ONE any-of group — the union
 *   of every referenced articleId — which preserves the OR semantics
 *   exactly. Span/visual-level granularity (spanIds/visualIds) and
 *   requiredClaims are for the human comparison report, not the mechanical
 *   scorer, and are intentionally not mapped.
 * - type prompt_injection_* -> injection: true with forbiddenInAnswer from
 *   requiredBehavior.mustNotContain.
 * - type no_answer -> expectedRefusal: true.
 * - mode passes through ("visual" enables the scorer's attached-image check).
 *
 * The output is deterministic given the input file; rerunning it cannot
 * change scores for frozen runs except through an explicit, reviewable diff.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface HoldoutSourceRef {
    articleId?: string;
}
interface HoldoutEvidenceGroup {
    sourceRefs?: HoldoutSourceRef[];
}
interface HoldoutQuestion {
    id: string;
    type?: string[];
    mode?: string;
    requiredBehavior?: { mustNotContain?: string[] };
    acceptableEvidenceGroups?: HoldoutEvidenceGroup[];
}
interface HoldoutCatalog {
    datasetId: string;
    questions: HoldoutQuestion[];
}

export function adaptHoldoutEvidence(catalog: HoldoutCatalog): {
    datasetId: string;
    adaptedFrom: string;
    questions: Record<string, unknown>[];
} {
    const questions = catalog.questions.map((q) => {
        const ids = new Set<string>();
        for (const group of q.acceptableEvidenceGroups ?? []) {
            for (const ref of group.sourceRefs ?? []) {
                if (ref.articleId) ids.add(ref.articleId);
            }
        }
        const types = q.type ?? [];
        const isInjection = types.some((t) => t.startsWith("prompt_injection"));
        const isNoAnswer = types.includes("no_answer");
        return {
            id: q.id,
            mode: q.mode,
            ...(ids.size > 0 ? { expectedSourceIdsAny: [...ids].sort() } : {}),
            ...(isInjection
                ? {
                      injection: true,
                      forbiddenInAnswer: q.requiredBehavior?.mustNotContain ?? [],
                  }
                : {}),
            ...(isNoAnswer ? { expectedRefusal: true } : {}),
        };
    });
    return {
        datasetId: catalog.datasetId,
        adaptedFrom: "evaluation/rag/holdout/rag-holdout-v1.json",
        questions,
    };
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const inIdx = argv.indexOf("--in");
    const outIdx = argv.indexOf("--out");
    if (inIdx === -1 || outIdx === -1) {
        throw new Error("Usage: adapt-holdout-evidence --in <holdout.json> --out <adapted.json>");
    }
    const catalog = JSON.parse(
        readFileSync(path.resolve(argv[inIdx + 1]), "utf8"),
    ) as HoldoutCatalog;
    const adapted = adaptHoldoutEvidence(catalog);
    const outPath = path.resolve(argv[outIdx + 1]);
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(adapted, null, 2)}\n`);
    console.log(
        JSON.stringify({
            questions: adapted.questions.length,
            withEvidence: adapted.questions.filter((q) => "expectedSourceIdsAny" in q).length,
            outPath,
        }),
    );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
