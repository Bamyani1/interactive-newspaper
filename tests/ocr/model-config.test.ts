import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

interface ModelConfig {
  name: string;
  thinking: "minimal" | "medium" | "high";
}

const promptsPath = path.resolve(__dirname, "../../ocr/src/prompts.json");
const config = JSON.parse(readFileSync(promptsPath, "utf-8")) as {
  models: Record<string, ModelConfig>;
  prompts: Record<string, string>;
};

describe("OCR Gemini model routing", () => {
  it("routes hard merge work to Gemini 3.6 Flash with medium thinking", () => {
    expect(config.models.merge).toEqual({
      name: "gemini-3.6-flash",
      thinking: "medium",
    });
    expect(config.models.seam_repair).toEqual(config.models.merge);
    expect(config.models).not.toHaveProperty("merge_fallback");
  });

  it("routes lightweight OCR calls to Gemini 3.5 Flash-Lite", () => {
    expect(config.models).toMatchObject({
      page_structuring: {
        name: "gemini-3.5-flash-lite",
        thinking: "high",
      },
      image_matching: {
        name: "gemini-3.5-flash-lite",
        thinking: "medium",
      },
      ad_enrichment: {
        name: "gemini-3.5-flash-lite",
        thinking: "minimal",
      },
      content_triage: {
        name: "gemini-3.5-flash-lite",
        thinking: "medium",
      },
    });
  });

  it("contains no preview or cross-model fallback route", () => {
    for (const model of Object.values(config.models)) {
      expect(model.name).not.toContain("preview");
    }
    expect(config.models).not.toHaveProperty("merge_fallback");
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
