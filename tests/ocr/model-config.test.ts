import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const promptsPath = path.resolve(__dirname, "../../ocr/src/prompts.json");
const config = JSON.parse(readFileSync(promptsPath, "utf-8")) as {
  prompts: Record<string, string>;
};

describe("OCR prompts", () => {
  it("carries no model routes: models live in model_calls.py", () => {
    expect(config).not.toHaveProperty("models");
  });

  it("retains every required production prompt", () => {
    expect(Object.keys(config.prompts).sort()).toEqual([
      "ad_enrichment_system",
      "ad_enrichment_user_template",
      "content_triage_system",
      "content_triage_user_template",
      "image_matching",
      "merge_system",
      "merge_user_template",
      "page_layout_supplement",
      "page_structuring",
      "seam_repair",
    ]);
  });
});
