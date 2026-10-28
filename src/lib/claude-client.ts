/**
 * Shared Claude Client
 *
 * Lazy-initialized singleton so the module can be imported without an API
 * key in the environment. Used by the reformulator, reranker, answer
 * generator, and agent loop.
 */

import Anthropic from "@anthropic-ai/sdk";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";

let _client: Anthropic | null = null;

export function getClaudeClient(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set.");
    }
    // No SDK retries: retryOnQuota owns backoff, and it has to fit inside
    // the request's own deadline.
    _client = new Anthropic({ maxRetries: 0 });
  }
  return _client;
}

/** A reply's text, without its thinking blocks. */
export function messageText(message: Pick<Anthropic.Message, "content">): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/**
 * Structured output for a JSON schema. Claude does not enforce length,
 * range, or count limits, so the SDK moves them into the descriptions as
 * guidance; callers still validate what comes back.
 */
export function jsonOutputFormat(schema: Record<string, unknown>): Anthropic.JSONOutputFormat {
  return { type: "json_schema", schema: transformJSONSchema(schema) };
}

/** Test-only reset for environment/configuration assertions. */
export function _resetClaudeClientForTests(): void {
  _client = null;
}
