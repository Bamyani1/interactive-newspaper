# Internal Engineering Notes

This directory holds inline engineering notes referenced from source code comments as `// See docs/issues/NNNN`. Each file documents a specific bug investigation, design decision, or hardening step with enough context for a future reader to understand *why* a piece of code looks the way it does.

Not every note from this project's history is tracked here — only the ones cited directly from committed source code. The format of each file follows [`TEMPLATE.md`](./TEMPLATE.md).

## Referenced issues

| ID | Title | Cited from |
|---|---|---|
| [0004](./0004-ci-missing-typescript-coverage.md) | CI missing TypeScript coverage (build step) | `.github/workflows/nextjs-ci.yml` |
| [0005](./0005-hybrid-search-no-timeout.md) | Hybrid search has no timeout | `src/lib/db.ts` |
| [0006](./0006-db-parsefloat-no-nan-check.md) | DB `parseFloat` no NaN check | `src/lib/db.ts` (×2) |
| [0007](./0007-image-proxy-silent-catch.md) | Image proxy silent catch | `src/app/api/editions/[date]/images/[...path]/route.ts` |
| [0008](./0008-page-extractor-parsed-none-access.md) | Page extractor `None` access | `ocr/src/transcript_ocr/recognition/page_extractor.py` |
| [0009](./0009-llm-merge-prompt-key-no-fallback.md) | LLM merge prompt-key no fallback | `ocr/src/transcript_ocr/config/prompts_loader.py` |
| [0010](./0010-content-rescue-bounds-silent-drop.md) | Content rescue bounds silent drop | `ocr/src/transcript_ocr/application/content_rescue.py` |
| [0011](./0011-edition-pipeline-broad-except-phases-4-5.md) | Edition pipeline broad `except` in phases 4–5 | `ocr/src/transcript_ocr/application/edition_pipeline.py` |
| [0012](./0012-llm-merge-error-truncated-500-chars.md) | LLM merge error truncated at 500 chars | `ocr/src/transcript_ocr/merging/llm_merge.py` |
| [0014](./0014-continuation-markers-truncated-text.md) | Continuation markers truncated text | `ocr/src/transcript_ocr/recognition/docai_provider.py` |
| [0016](./0016-admin-revalidate-token-no-timing-safety.md) | Admin revalidate token no timing safety | `src/app/api/admin/revalidate/route.ts` (×2) |
| [0018](./0018-cleanup-images-nan-tokenscore.md) | `cleanup-images` NaN token score | `scripts/cleanup-images.mjs` |
| [0020](./0020-ocr-tempfile-no-unique-prefix.md) | OCR tempfile no unique prefix | `ocr/src/transcript_ocr/application/{ad_enrichment,content_rescue}.py` |
| [0021](./0021-llm-merge-oob-article-ids-no-diagnostic.md) | LLM merge OOB article IDs — no diagnostic | `ocr/src/transcript_ocr/merging/llm_merge.py` |
| [0022](./0022-flash-retry-usage-metadata-none.md) | Flash retry usage metadata `None` | `ocr/src/transcript_ocr/merging/llm_merge.py` |
| [0023](./0023-embed-mjs-silent-image-fallback.md) | `embed.mjs` silent image fallback | `scripts/db/embed.mjs` |
| [0024](./0024-weather-raw-response-type-cast.md) | Weather raw response type cast | `src/lib/weather.ts` |
| [0025](./0025-weather-route-input-bounds.md) | Weather route input bounds | `src/app/api/weather/route.ts` (×2) |
| [0028](./0028-embed-no-quota-backoff.md) | Embed no quota backoff | `src/lib/embeddings.ts`, `scripts/db/embed.mjs`, `scripts/db/seed.mjs` |
| [0029](./0029-seed-wipes-embeddings-on-every-run.md) | Seed wipes embeddings on every run | `scripts/db/seed.mjs` (×2) |

## Purpose

Each issue file captures the root cause, the fix, and (where applicable) a small regression test that proves the fix sticks. The goal is to preserve the *why* behind each change so reviewers and future contributors don't have to reverse-engineer it from git history alone.
