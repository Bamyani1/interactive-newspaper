# Issue Tracker

In-repo bug and issue tracking for The Transcript Archive. Each issue is a
markdown file in this directory, named `NNNN-kebab-title.md`. This index links
to them and summarizes status.

## Conventions

- **ID** — four-digit zero-padded, assigned in chronological order of filing.
- **Status** — `open` · `fixed` · `wontfix` · `duplicate` · `invalid`
- **Severity** — `critical` · `high` · `medium` · `low`
- **Area** — `rag` · `api` · `ui` · `ocr` · `scripts` · `db` · `infra` · `ci` · `deps`

When opening a new issue, copy `TEMPLATE.md`, pick the next ID, and add a
row to the table below.

When closing, flip `status:` in the frontmatter and update this index (move
the row to the "Closed issues" section with the closing date).

## Open issues

| ID | Title | Area | Severity | Opened |
|---:|---|---|---|---|
| 0004 | [CI workflow has no Next.js TS build/lint/test coverage](0004-ci-missing-typescript-coverage.md) | ci | critical | 2026-04-13 |
| 0007 | [Image proxy silent catch opaques FS errors as 404](0007-image-proxy-silent-catch.md) | api | high | 2026-04-13 |
| 0008 | [page_extractor accesses .page_number on possibly-None response.parsed](0008-page-extractor-parsed-none-access.md) | ocr | high | 2026-04-13 |
| 0009 | [llm_merge uses PROMPTS["seam_repair"] with no key fallback](0009-llm-merge-prompt-key-no-fallback.md) | ocr | high | 2026-04-13 |
| 0010 | [content_rescue silently drops out-of-bounds index decisions](0010-content-rescue-bounds-silent-drop.md) | ocr | high | 2026-04-13 |
| 0011 | [edition_pipeline broad except in Phase 4/5 masks Gemini 503s](0011-edition-pipeline-broad-except-phases-4-5.md) | ocr | high | 2026-04-13 |
| 0012 | [llm_merge parse-failure error message truncated to 500 chars](0012-llm-merge-error-truncated-500-chars.md) | ocr | high | 2026-04-13 |
| 0013 | [merge retry exhaustion raises without fallback to unmerged edition](0013-merge-retry-exhaustion-no-fallback.md) | ocr | high | 2026-04-13 |
| 0014 | [continuation marker extraction returns [] on truncated page text](0014-continuation-markers-truncated-text.md) | ocr | high | 2026-04-13 |
| 0015 | [image_linking visual→spatial fallback invisible in diagnostics](0015-image-linking-visual-fallback-invisible.md) | ocr | high | 2026-04-13 |
| 0016 | [/api/admin/revalidate uses string-equality token check, no rate limit](0016-admin-revalidate-token-no-timing-safety.md) | api | medium | 2026-04-13 |
| 0017 | [next.config.ts image optimization changes uncommitted](0017-next-config-image-opts-uncommitted.md) | infra | medium | 2026-04-13 |
| 0018 | [cleanup-images.mjs tokenScore can become NaN on empty captionTokens](0018-cleanup-images-nan-tokenscore.md) | scripts | medium | 2026-04-13 |
| 0019 | [weather build has no inline post-build validation](0019-weather-build-no-inline-validation.md) | scripts | medium | 2026-04-13 |
| 0020 | [OCR tempfile creation uses suffix-only](0020-ocr-tempfile-no-unique-prefix.md) | ocr | medium | 2026-04-13 |
| 0021 | [llm_merge tolerates out-of-bounds article_ids with only a warning](0021-llm-merge-oob-article-ids-no-diagnostic.md) | ocr | medium | 2026-04-13 |
| 0022 | [flash-retry reads usage_metadata without chained None check](0022-flash-retry-usage-metadata-none.md) | ocr | medium | 2026-04-13 |
| 0023 | [embed.mjs silently degrades to text-only when local images missing](0023-embed-mjs-silent-image-fallback.md) | scripts | medium | 2026-04-13 |
| 0024 | [weather.ts uses `as unknown as` double-cast for raw OpenMeteo response](0024-weather-raw-response-type-cast.md) | api | low | 2026-04-13 |
| 0025 | [/api/weather route doesn't bound-check lat/lon/location_name](0025-weather-route-input-bounds.md) | api | low | 2026-04-13 |
| 0026 | [p-limit resolves to two versions in the lockfile](0026-p-limit-duplicate-versions.md) | deps | low | 2026-04-13 |
| 0027 | [.gitignore adds scripts/dev/data/ without explanatory comment](0027-gitignore-dev-data-comment.md) | infra | low | 2026-04-13 |

## Closed issues

| ID | Title | Area | Severity | Closed |
|---:|---|---|---|---|
| 0001 | [seed.mjs embed loop passes strings to embedDocuments](0001-seed-embed-type-mismatch.md) | scripts | critical | 2026-04-14 |
| 0002 | [seed.mjs embedArticles swallows batch errors; seed exits 0](0002-seed-embed-error-swallow.md) | scripts | critical | 2026-04-14 |
| 0003 | [embed.mjs exits 0 even when per-batch retries fail](0003-embed-mjs-exit-zero-on-errors.md) | scripts | critical | 2026-04-14 |
| 0005 | [hybridSearch has no timeout wrapper](0005-hybrid-search-no-timeout.md) | db | critical | 2026-04-14 |
| 0006 | [db.ts parseFloat on distance/rank produces unchecked NaN](0006-db-parsefloat-no-nan-check.md) | db | high | 2026-04-14 |
| 0028 | [Embed pipeline has no 429/quota-exhausted detection or early-abort](0028-embed-no-quota-backoff.md) | rag | medium | 2026-04-14 |
| 0029 | [seedEditions wipes all embeddings on every seed run](0029-seed-wipes-embeddings-on-every-run.md) | scripts | critical | 2026-04-14 |
| 0030 | [embedDocuments has no timeout wrapper (asymmetric with embedQuery)](0030-embed-documents-no-timeout.md) | rag | critical | 2026-04-14 |
| 0031 | [embedDocuments multimodal branch could silently leave reassembly holes](0031-embed-multimodal-partial-failure.md) | rag | medium | 2026-04-14 |
| 0032 | [/api/ask has no global deadline (worst-case 43s+ cumulative timeout)](0032-api-ask-no-global-deadline.md) | rag | critical | 2026-04-14 |
| 0033 | [/api/ask catch-all returns opaque 500 with no stage or requestId](0033-api-ask-opaque-500-no-stage-info.md) | rag | medium | 2026-04-14 |
| 0034 | [/api/search has no length limit, no timeout, silent 500 swallow](0034-api-search-hardening.md) | api | medium | 2026-04-14 |
| 0035 | [answer-generator confidence-default brittleness for FTS-only retrieval](0035-confidence-default-brittleness.md) | rag | medium | 2026-04-14 |
| 0036 | [/api/ask runs full pipeline twice for concurrent identical requests](0036-api-ask-no-concurrent-dedup.md) | rag | low | 2026-04-14 |
