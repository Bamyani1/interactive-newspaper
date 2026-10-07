/**
 * Shared Gemini Client
 *
 * Lazy-initialized singleton so the module can be imported without eagerly
 * resolving Application Default Credentials. Used by embeddings, reformulator,
 * reranker, and answer generator.
 */

import { GoogleGenAI } from "@google/genai";

let _client: GoogleGenAI | null = null;

/**
 * Service-account credentials for a Vertex environment with no gcloud ADC
 * on disk — the Vercel serving path, which has no home directory to read
 * and no metadata server to ask.
 *
 * Accepts the raw key JSON or a base64 copy of it. Base64 is worth
 * supporting because the JSON is multi-line and carries an escaped private
 * key, which survives a CLI or dashboard round-trip far less reliably than
 * a single line does.
 *
 * A value that is set but unusable throws rather than falling back to ADC.
 * Falling back would strand the request at the first model call with an
 * unrelated credentials error, several layers away from the typo.
 */
function serviceAccountCredentials(): { client_email: string; private_key: string } | undefined {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return undefined;
  const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  let parsed: { client_email?: unknown; private_key?: unknown };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is set but is neither service-account JSON nor base64 of it."
    );
  }
  if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON parsed, but has no client_email/private_key — not a service-account key."
    );
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

export function getGeminiClient(): GoogleGenAI {
  if (!_client) {
    // Vertex only: ADC for local dev and the data pipeline, a service
    // account on Vercel. Serving on Vertex also puts query embeddings on
    // the endpoint that produced the index. There is no API-key mode: a
    // key bills a different account, so a missing project fails here
    // instead of quietly moving the spend.
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    if (!project) {
      throw new Error(
        "GOOGLE_CLOUD_PROJECT is not set. Gemini runs only on Vertex AI; API keys are not used."
      );
    }
    // Credentials, when supplied, are the only difference between the
    // two Vertex environments: locally ADC resolves itself and this is
    // undefined.
    const credentials = serviceAccountCredentials();
    _client = new GoogleGenAI({
      vertexai: true,
      project,
      location: process.env.GOOGLE_CLOUD_LOCATION || "global",
      apiVersion: "v1",
      ...(credentials ? { googleAuthOptions: { credentials } } : {}),
    });
  }
  return _client;
}

/** Test-only reset for environment/configuration assertions. */
export function _resetGeminiClientForTests(): void {
  _client = null;
}
