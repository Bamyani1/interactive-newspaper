# Internal Engineering Notes

This directory holds inline engineering notes referenced from source code comments as `// See docs/issues/NNNN`. Each file documents a specific bug investigation, design decision, or hardening step with enough context for a future reader to understand *why* a piece of code looks the way it does.

The format of each file follows [`TEMPLATE.md`](./TEMPLATE.md).

Eleven of the notes below are **no longer cited from any source file**. Most of those
describe the OCR and merge code, which was rewritten in `88d7b27 feat(ocr): finalize ADC
production pipeline` — the rewrite did not carry the `// See docs/issues/NNNN` comments
across. The notes are kept because the reasoning still explains why the current code
behaves as it does, but treat them as background, not as an annotation of a specific line.

Every note was opened as a fix. The Status column records what is true now: `superseded`
means a later rewrite replaced the fix with a different mechanism, `obsolete` means the
code is gone, and `mitigated` means the risk is reduced but the pattern remains. Each of
those notes opens with a short line saying what replaced it.

The "Cited from" column below was verified against the working tree; keep it that way
when adding or removing a citation.

## Notes

| ID | Title | Status | Cited from |
|---|---|---|---|
| [0004](./0004-ci-missing-typescript-coverage.md) | CI missing TypeScript coverage (build step) | fixed | — |
| [0005](./0005-hybrid-search-no-timeout.md) | Hybrid search has no timeout | fixed | — |
| [0006](./0006-db-parsefloat-no-nan-check.md) | DB `parseFloat` no NaN check | fixed | `src/lib/db.ts` |
| [0007](./0007-image-proxy-silent-catch.md) | Image proxy silent catch | fixed | `src/app/api/editions/[date]/images/[...path]/route.ts` |
| [0008](./0008-page-extractor-parsed-none-access.md) | Page extractor `None` access | superseded | — |
| [0009](./0009-llm-merge-prompt-key-no-fallback.md) | LLM merge prompt-key no fallback | fixed | `ocr/src/transcript_ocr/config/prompts_loader.py` |
| [0010](./0010-content-rescue-bounds-silent-drop.md) | Content rescue bounds silent drop | superseded | — |
| [0011](./0011-edition-pipeline-broad-except-phases-4-5.md) | Edition pipeline broad `except` in phases 4–5 | mitigated | — |
| [0012](./0012-llm-merge-error-truncated-500-chars.md) | LLM merge error truncated at 500 chars | superseded | — |
| [0014](./0014-continuation-markers-truncated-text.md) | Continuation markers truncated text | obsolete | — |
| [0016](./0016-admin-revalidate-token-no-timing-safety.md) | Admin revalidate token no timing safety | fixed | `src/app/api/admin/revalidate/route.ts`, `src/app/api/internal/retention/route.ts` |
| [0018](./0018-cleanup-images-nan-tokenscore.md) | `cleanup-images` NaN token score | fixed | `scripts/cleanup-images.mjs` |
| [0020](./0020-ocr-tempfile-no-unique-prefix.md) | OCR tempfile no unique prefix | fixed | `ocr/src/transcript_ocr/application/ad_enrichment.py` |
| [0021](./0021-llm-merge-oob-article-ids-no-diagnostic.md) | LLM merge OOB article IDs — no diagnostic | superseded | — |
| [0022](./0022-flash-retry-usage-metadata-none.md) | Flash retry usage metadata `None` | obsolete | — |
| [0023](./0023-embed-mjs-silent-image-fallback.md) | `embed.mjs` silent image fallback | superseded | — |
| [0024](./0024-weather-raw-response-type-cast.md) | Weather raw response type cast | fixed | `src/lib/weather.ts` |
| [0025](./0025-weather-route-input-bounds.md) | Weather route input bounds | fixed | `src/app/api/weather/route.ts` |
| [0028](./0028-embed-no-quota-backoff.md) | Embed no quota backoff | fixed | `src/lib/embeddings.ts`, `scripts/db/seed.mjs` |
| [0029](./0029-seed-wipes-embeddings-on-every-run.md) | Seed wipes embeddings on every run | fixed | — |

## Purpose

Each issue file captures the root cause, the fix, and (where applicable) a small regression test that proves the fix sticks. The goal is to preserve the *why* behind each change so reviewers and future contributors don't have to reverse-engineer it from git history alone.
