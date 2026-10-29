/**
 * Retrieval metrics over pooled 0-2 grades, and a paired bootstrap for
 * comparing two variants on the same questions.
 */

const RELEVANT = 1;

/** Share of the pool's relevant articles (grade >= 1) in the top k; null when none are. */
export function recallAt(ranked: string[], grades: Map<string, number>, k: number): number | null {
  const relevant = [...grades].filter(([, grade]) => grade >= RELEVANT).map(([id]) => id);
  if (relevant.length === 0) return null;
  const top = new Set(ranked.slice(0, k));
  return relevant.filter((id) => top.has(id)).length / relevant.length;
}

const gain = (grade: number) => 2 ** grade - 1;
const discount = (rank: number) => Math.log2(rank + 2);

/** Graded nDCG@k against the ideal order of the pool's grades; null when nothing is relevant. */
export function ndcgAt(ranked: string[], grades: Map<string, number>, k: number): number | null {
  const ideal = [...grades.values()]
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((sum, grade, rank) => sum + gain(grade) / discount(rank), 0);
  if (ideal === 0) return null;
  const actual = ranked
    .slice(0, k)
    .reduce((sum, id, rank) => sum + gain(grades.get(id) ?? 0) / discount(rank), 0);
  return actual / ideal;
}

/** Nearest-rank percentile. */
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

/** Small seeded PRNG so a bootstrap run can be repeated exactly. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

/**
 * 95% interval for the mean of per-question differences (variant B minus
 * variant A), resampling questions with replacement.
 */
export function pairedBootstrap(
  diffs: number[],
  { resamples = 10_000, seed }: { resamples?: number; seed: number }
): { mean: number; low: number; high: number; n: number } {
  const random = mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    let sum = 0;
    for (let i = 0; i < diffs.length; i += 1) sum += diffs[Math.floor(random() * diffs.length)];
    means.push(sum / diffs.length);
  }
  return {
    mean: mean(diffs),
    low: percentile(means, 2.5),
    high: percentile(means, 97.5),
    n: diffs.length,
  };
}
