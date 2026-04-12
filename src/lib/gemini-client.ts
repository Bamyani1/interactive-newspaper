/**
 * Shared Gemini Client
 *
 * Lazy-initialized singleton so the module can be imported without a key
 * (for tests / optional features). Used by embeddings, reformulator,
 * reranker, and answer generator.
 */

import { GoogleGenAI } from "@google/genai";

let _client: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!_client) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY or GOOGLE_API_KEY environment variable is required.",
      );
    }
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}
