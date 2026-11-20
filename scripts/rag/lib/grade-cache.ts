/**
 * Relevance grades cached by (question, article, prompt version), so a
 * rerun or a new variant only pays for pairs nobody has graded yet.
 */

import { createHash } from "node:crypto";

export interface GradePair {
  question: string;
  articleId: string;
}

export function gradeKey(question: string, articleId: string, promptVersion: string): string {
  const questionHash = createHash("sha256").update(question).digest("hex").slice(0, 16);
  return `${questionHash}:${articleId}:${promptVersion}`;
}

/** Grades for every pair, calling `grade` only for pairs missing from `cache` (which it fills). */
export async function gradePool(
  pairs: GradePair[],
  grade: (pair: GradePair) => Promise<number>,
  cache: Map<string, number>,
  promptVersion: string,
  concurrency = 4
): Promise<Map<string, number>> {
  const keyed = pairs.map((pair) => ({
    pair,
    key: gradeKey(pair.question, pair.articleId, promptVersion),
  }));
  const missing = [...new Map(keyed.filter(({ key }) => !cache.has(key)).map((k) => [k.key, k]))];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, missing.length) }, async () => {
      while (next < missing.length) {
        const [key, { pair }] = missing[next];
        next += 1;
        cache.set(key, await grade(pair));
      }
    })
  );
  return new Map(keyed.map(({ key }) => [key, cache.get(key) as number]));
}
