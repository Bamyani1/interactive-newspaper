import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeHoldoutSha256,
  fileSha256,
  validateEvaluationFreeze,
} from "../../scripts/rag/verify-evaluation-freeze";

function readJson(filePath: string) {
  return JSON.parse(readFileSync(path.resolve(filePath), "utf8"));
}

describe("RAG evaluation freeze", () => {
  const corpus = readJson("evaluation/rag/corpus/legacy-8b8207373510d69e.json");
  const inventory = readJson(
    "evaluation/rag/source-inventory/contentdm-p15963coll9-6a9d9286b30620f7.json",
  );
  const developmentPath = path.resolve("tests/api/rag-golden-questions.json");
  const developmentContents = readFileSync(developmentPath);
  const development = JSON.parse(developmentContents.toString("utf8"));
  const holdout = readJson("evaluation/rag/holdout/rag-holdout-v1.json");

  it("labels all previously used questions as development data", () => {
    expect(development).toMatchObject({
      schemaVersion: 2,
      split: "development",
      datasetId: "rag-development-v1",
    });
    expect(development.questions).toHaveLength(12);
  });

  it("binds the blind holdout to the frozen corpus, source scans, and evidence spans", () => {
    const result = validateEvaluationFreeze(
      corpus,
      inventory,
      development,
      fileSha256(developmentContents),
      holdout,
    );

    expect(result).toMatchObject({
      datasetId: "rag-holdout-v1",
      status: "frozen_unrun",
      sourceCount: 10,
      questionCount: 14,
      developmentSourceOverlapCount: 0,
    });
  });

  it("has a reproducible content hash", () => {
    expect(computeHoldoutSha256(holdout)).toBe(holdout.integrity.holdoutSha256);
  });

  it("fails when a frozen evidence reference is changed", () => {
    const changed = structuredClone(holdout);
    changed.questions[0].acceptableEvidenceGroups[0].sourceRefs[0].spanIds = [
      "not-a-real-span",
    ];
    changed.integrity.holdoutSha256 = computeHoldoutSha256(changed);

    expect(() =>
      validateEvaluationFreeze(
        corpus,
        inventory,
        development,
        fileSha256(developmentContents),
        changed,
      ),
    ).toThrow(/unknown span/);
  });
});
