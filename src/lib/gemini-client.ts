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
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    if (!project) {
      throw new Error(
        "GOOGLE_CLOUD_PROJECT is required for Vertex AI Application Default Credentials.",
      );
    }
    _client = new GoogleGenAI({
      vertexai: true,
      project,
      location: process.env.GOOGLE_CLOUD_LOCATION || "global",
      apiVersion: "v1",
    });
  }
  return _client;
}

/** Test-only reset for environment/configuration assertions. */
export function _resetGeminiClientForTests(): void {
  _client = null;
}
