/**
 * Citation rewriting shared by the answer renderer and "copy answer".
 *
 * Answers arrive with one of two citation shapes:
 *   - pipeline:  [Source N]
 *   - agent:     [YYYY-MM-DD-N] or [YYYY-MM-DD-N, YYYY-MM-DD-N, …]
 *
 * Both are rewritten to the 1-based source index the reader actually
 * sees. The renderer turns them into anchors; the clipboard gets plain
 * [N] so a pasted answer keeps its evidence without dead links.
 *
 * Each pattern swallows the space in front of the citation, and the
 * space behind it when punctuation follows. Two visible defects came
 * from not doing that: the model writes "West Campus [id] ." with a
 * space before the full stop, which rendered as a floating "[3] ."; and
 * an agent citation that cannot be resolved is dropped entirely, which
 * left a bare " ." for the whole of an agent answer, since the source
 * list only arrives with the final frame. Trailing space is taken only
 * ahead of punctuation, so "[id] and" never becomes "[3]and".
 */

const CITATION_TRAILING = "(?:[ \\t]+(?=[.,;:!?]))?";

const PIPELINE_CITATION_RE = new RegExp(`[ \\t]*\\[Source (\\d+)\\]${CITATION_TRAILING}`, "g");

const AGENT_CITATION_RE = new RegExp(
  `[ \\t]*\\[(\\d{4}-\\d{2}-\\d{2}-\\d+(?:\\s*,\\s*\\d{4}-\\d{2}-\\d{2}-\\d+)*)\\]${CITATION_TRAILING}`,
  "g"
);

/**
 * Rewrite both citation shapes with `render`, which receives the source
 * index. An agent citation whose ids don't resolve is dropped — the
 * bracket is noise to a reader who has no matching source card.
 */
function rewriteCitations(
  text: string,
  render: (index: number | string) => string,
  articleIdIndex?: Map<string, number>
): string {
  const out = text.replace(PIPELINE_CITATION_RE, (_match, n: string) => ` ${render(n)}`);
  return out.replace(AGENT_CITATION_RE, (_match, inner: string) => {
    const resolved = inner
      .split(/\s*,\s*/)
      .map((id) => articleIdIndex?.get(id))
      .filter((num): num is number => num !== undefined)
      .map(render);
    return resolved.length === 0 ? "" : ` ${resolved.join(" ")}`;
  });
}

/**
 * Citations as markdown links into the turn's own source cards. Anchors
 * are turn-scoped so a citation resolves within its own turn instead of
 * jumping to the first turn in the transcript.
 */
export function linkCitations(
  text: string,
  turnId: string,
  articleIdIndex?: Map<string, number>
): string {
  return rewriteCitations(text, (n) => `[[${n}]](#ask-source-${turnId}-${n})`, articleIdIndex);
}

/** Citations as bare `[N]` — what belongs on the clipboard. */
export function flattenCitations(text: string, articleIdIndex?: Map<string, number>): string {
  return rewriteCitations(text, (n) => `[${n}]`, articleIdIndex);
}
