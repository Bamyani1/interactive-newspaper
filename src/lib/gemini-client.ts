/**
 * Shared Gemini Client
 *
 * Lazy-initialized singleton so the module can be imported without eagerly
 * resolving Application Default Credentials. Used by embeddings, reformulator,
 * reranker, and answer generator.
 */

import { GoogleGenAI } from "@google/genai";

let _client: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!_client) {
    // Two auth modes: Vertex + ADC when GOOGLE_CLOUD_PROJECT is set (local
    // dev and the data pipeline, where ADC is the locked provenance
    // decision); otherwise Gemini API-key mode -- the serving path on
    // Vercel, where no ADC exists, and the same mechanism production used
    // before the Vertex migration. Model names and the embedding space are
    // identical across both endpoints.
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    if (project) {
      _client = new GoogleGenAI({
        vertexai: true,
        project,
        location: process.env.GOOGLE_CLOUD_LOCATION || "global",
        apiVersion: "v1",
      });
    } else {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        throw new Error(
          "Gemini auth is not configured: set GOOGLE_CLOUD_PROJECT for Vertex ADC, or GEMINI_API_KEY / GOOGLE_API_KEY for API-key mode.",
        );
      }
      _client = new GoogleGenAI({ apiKey, apiVersion: "v1" });
    }
  }
  return _client;
}

/** Test-only reset for environment/configuration assertions. */
export function _resetGeminiClientForTests(): void {
  _client = null;
}
