# OCR Pipeline

> Deep-dive on the Python pipeline that turns newspaper scans into `edition.json`.
> Audience: contributors extending, debugging, or reviewing the pipeline.

**See also**: [data-model.md](data-model.md) for how `edition.json` becomes DB rows, and [rag-pipeline.md](rag-pipeline.md) for how those rows get queried.

## Table of contents

- [What the pipeline does](#what-the-pipeline-does)
- [Quickstart — process one edition](#quickstart--process-one-edition)
- [Seven-phase flow](#seven-phase-flow)
- [Layer architecture](#layer-architecture)
- [Data contracts](#data-contracts)
- [Stage walkthrough](#stage-walkthrough)
- [LLM integration](#llm-integration)
- [Failure modes](#failure-modes)
- [Diagnostics & observability](#diagnostics--observability)
- [Cost & rate controls](#cost--rate-controls)
- [Local dev workflow](#local-dev-workflow)
- [Testing](#testing)
- [Architecture invariants (CI-enforced)](#architecture-invariants-ci-enforced)
- [Gotchas](#gotchas)

---

## What the pipeline does

One invocation runs one newspaper edition. Input: a directory of numbered TIF/JPG scans for a single issue. Output: `public/editions/<YYYY-MM-DD>/edition.json` — a structured document containing articles, ads, other content, and publication metadata, plus extracted image crops.

The pipeline is **not** pure OCR. Raw character recognition is one of seven phases. The harder work is structuring — deciding which paragraphs form an article, which images belong to which article, and which article fragments across pages are continuations of the same story.

Two LLMs are used side-by-side: **Google Cloud Document AI** (deterministic character-level extraction) and **Gemini** (semantic structuring, merging, enrichment). DocAI is authoritative for text; Gemini is never asked to re-read characters it could hallucinate.

---

## Quickstart — process one edition

```bash
# 1. Drop scans in an inbox dir named YYYY-MM-DD
mv ~/Downloads/1960-01-13 ocr/inbox/

# 2. Process
scripts/ocr/process-edition.sh ocr/inbox/1960-01-13

# 3. Inspect output
jq '.articles | length' public/editions/1960-01-13/edition.json
open   public/editions/1960-01-13/edition.json
```

Required env vars are sourced from `.env.local` by the wrapper. See [Local dev workflow](#local-dev-workflow) for the full flag surface.

---

## Seven-phase flow

```
Phase 0   TIF → PNG conversion                preprocessing.image_converter
Phase 1a  Per-page preprocessing              preprocessing.image_preprocessor
Phase 1b  Layout detection (figures)          detection.yolo_provider
Phase 1c  DocAI text extraction               recognition.docai_provider          parallel pages
Phase 2   Gemini page structuring             recognition.page_extractor          parallel pages
Phase 3   Cross-page merging                  merging.llm_merge                   edition-level
Phase 4   Ad enrichment                       application.ad_enrichment           edition-level
Phase 5   Content triage                      application.content_rescue          edition-level
Phase 6   Write edition.json + diagnostics    export.edition_writer + diagnostics edition-level
```

Phases 1a/1b/1c all execute per-page in the same `ThreadPoolExecutor` pass before Phase 2 starts. The orchestrator is `application/edition_pipeline.py :: process_edition()`. Phases 1 and 2 use `ThreadPoolExecutor(max_workers=workers)`; all other phases are sequential. `workers` comes from `--workers N` or `OCR_WORKERS` env var (default 1).

---

## Layer architecture

The pipeline is organized into ten domain layers plus three infrastructure layers. The dependency rule is strict and **CI-enforced**:

```
application  →  { recognition | preprocessing | detection | merging |
                  postprocessing | image_linking | export | diagnostics | ingestion }
                                   ↓
                              { contracts | shared | config }
```

No lower layer may import from `application`. `contracts` and `shared` may not import from any domain layer. Enforced by `tests/ocr/architecture/test_import_rules.py` using AST-level static analysis — no imports are executed, so violations are caught before they can fail a runtime dep check.

### `application/` — orchestration only

| Module | Purpose |
|---|---|
| `edition_pipeline.py` | Seven-phase orchestrator; owns `ThreadPoolExecutor`, `PipelineReport`, phase gates |
| `page_pipeline.py` | Two-phase page entrypoints: `extract_page_docai()` and `structure_and_link_page()` |
| `ad_enrichment.py` | Phase 4 runtime: reads/writes `edition.json`, calls Gemini for ad enrichment |
| `content_rescue.py` | Phase 5 runtime: content triage, demote/promote decisions |

### `recognition/` — text extraction

| Module | Purpose |
|---|---|
| `docai_provider.py` | Document AI client; `extract_page_text()` → `DocAIResult` |
| `page_extractor.py` | `process_page_with_docai()` — Gemini call + dedup + postprocess |
| `prompts.py`, `ad_prompts.py`, `rescue_prompts.py` | Prompt constants (loaded from `ocr/src/prompts.json`) |

### `ingestion/` — file discovery

| Module | Purpose |
|---|---|
| `discovery.py` | `discover_page_images()` — glob + sort page images after Phase 0 |
| `pathing.py` | Edition-directory path helpers |

### `preprocessing/` — image prep

| Module | Purpose |
|---|---|
| `image_converter.py` | Phase 0: TIF → grayscale PNG |
| `image_preprocessor.py` | `preprocess_image()`: EXIF, grayscale, deskew, contrast, unsharp mask |
| `skew.py` | `_detect_skew_angle()` — horizontal projection variance sweep |

### `detection/` — layout detection

| Module | Purpose |
|---|---|
| `yolo_provider.py` | DocLayout-YOLO loader (lazy singleton, thread-locked); `detect_image_regions()` |
| `region_filters.py` | `dedupe_overlapping_regions()` (IoU-based NMS); `should_keep_region()` |

### `merging/` — cross-page article stitching

| Module | Purpose |
|---|---|
| `llm_merge.py` | `merge_edition_articles()` — Gemini-assisted merge orchestration |
| `continuation.py` | Regex-based continuation marker parsing |
| `boundary_cleanup.py` | Truncated-word joining + duplicate-sentence removal at seams |
| `deterministic_merge.py` | Exact-marker pre-merge pass (runs before LLM) |
| `merge_sanitizer.py` | `_reconcile_image_alignment`, `_choose_merged_category`, seam guards |

### `postprocessing/` — per-page cleanup

| Module | Purpose |
|---|---|
| `ad_reclassification.py` | `postprocess_page_content()` — regex signal counting to demote ad-like articles |
| `deduplication.py` | Sentence-overlap dedup within a page |
| `byline_cleanup.py` | Normalize bylines, split author/position |
| `null_sanitizer.py` | Clear literal `"null"`/`"none"` strings from Pydantic fields |

### `image_linking/` — image-to-article assignment

| Module | Purpose |
|---|---|
| `visual_matcher.py` | Gemini classifies annotated region crops → `ImageRegionAssignments` |
| `spatial_matcher.py` | Geometric fallback when visual matching fails |
| `assignment_applier.py` | Maps Gemini response indices to PageContent lists |
| `cropper.py` | PIL crops; draws numbered red rectangles on annotated variants |

### `export/` — artifact writing

| Module | Purpose |
|---|---|
| `edition_writer.py` | `finalize_and_write_edition_json()`; final sanitize pass |
| `artifact_writer.py` | `write_diagnostics_json()`, `write_issue_reports()` |
| `markdown_writer.py` | Per-page `.md` files and edition summary |

### `diagnostics/` — observability

| Module | Purpose |
|---|---|
| `snapshots.py` | `save_snapshot()` — idempotent JSON dumps of any stage |
| `issue_report.py` | Post-run automated issue detection |
| `run_manifest.py` | SHA256 of inputs + git commit provenance |

### `contracts/` — shapes only

Pydantic models and dataclasses. Zero domain imports. Content models (`content_models.py`) define the shapes of everything that flows between layers and the final `edition.json`. Diagnostics models (`diagnostics_models.py`) define observability shapes.

### `shared/` — primitives

| Module | Purpose |
|---|---|
| `retry.py` | `gemini_generate_with_retry()` — retry with backoff + model fallback |
| `console.py` | Rich-based terminal output helpers |
| `text.py` | `normalize_whitespace`, `split_sentences`, `normalize_for_compare` |
| `timing.py`, `filesystem.py` | Generic helpers |

---

## Data contracts

All contracts are Pydantic or dataclasses in `ocr/src/transcript_ocr/contracts/`.

### Content flow

```
         Phase 2                        Phase 3                          Phase 6
PageContent  ────────►  EditionContent  ────────►  edition.json (+enriched_ads,
                                                       +content_triaged)
 ├ articles[]                 ├ articles[] (MergedArticle)
 ├ ads[]                      ├ ads[]
 ├ other_content[]            └ other_content[]
 └ publication_info
```

### `PageContent` (output of one page through Phase 2)

- `articles: list[Article]`
- `ads: list[Ad]`
- `other_content: list[OtherContent]`
- `page_number: str`, `publication_info: str`

### `Article` fields

| Field | Type | Notes |
|---|---|---|
| `headline` | `str` | required, default `""` |
| `author` | `str` | may include section tag, e.g. `"By Name, Sports"` |
| `writer_position` | `str` | role line if present |
| `category` | `Literal[...]` | one of five fixed values, default `"Campus News"` |
| `body` | `str` | raw paragraph text |
| `images` | `list[ArticleImage]` | each has `caption`, `position` |
| `image_files` | `list[str]` | filenames; **must stay aligned with `images`** |
| `continues_on`, `continued_from` | `str` | normalized; `"?"` means uncertain |

The `images` ↔ `image_files` alignment invariant is important: same length, same order. Mismatches are flagged as `issue_report.json` entries by `diagnostics/issue_report.py`.

### `MergedArticle` (output of Phase 3)

Extends `Article` with `source_pages: list[str]`. `body` becomes optional for singleton groups.

### Structured-output schemas (LLM response shapes)

These are Pydantic models passed as `response_schema` to Gemini:

- `MergeDecisions` → `list[MergeInstruction]` — which article ids to join, plus the merged headline/author
- `ImageRegionAssignments` → `list[ImageRegionAssignment]` — region number → (content_type, content_index, caption)
- `ContentTriageResponse` → suspect-article decisions and other-content decisions
- `EnrichedAdsResponse` → `list[EnrichedAd]` — adds `category`, `ad_type`, `display_text`, `phone`, `address`, `price`

### Final `edition.json`

```jsonc
{
  "edition_date": "1960-01-13",
  "publication_info": "The Ohio Wesleyan Transcript ...",
  "articles":      [ /* MergedArticle */ ],
  "ads":           [ /* Ad */ ],
  "other_content": [ /* OtherContent */ ],
  "enriched_ads":  [ /* EnrichedAd — added by Phase 4 */ ],
  "content_triaged": true                  // added by Phase 5
}
```

Written by `export/edition_writer.py :: finalize_and_write_edition_json()`. `enriched_ads` is appended in-place by Phase 4 via atomic tempfile rename; `content_triaged: true` is appended similarly by Phase 5.

---

## Stage walkthrough

### Phase 0 — TIF → PNG

`preprocessing/image_converter.py :: convert_edition_images()`. Globs `*.tif`/`*.tiff`, converts each to grayscale PNG via PIL, deletes the original. Raises `RuntimeError` if any TIF remains after conversion (sanity guard against silent partial conversion). JPGs pass through untouched.

Then `ingestion/discovery.py :: discover_page_images()` globs all remaining image extensions and returns them sorted. Sort order relies on zero-padded filename prefixes like `0001_Page 1.png`.

### Phase 1a — Preprocessing (per page)

`preprocessing/image_preprocessor.py :: preprocess_image()`:

1. `ImageOps.exif_transpose` — respect EXIF rotation
2. Convert to grayscale
3. `_detect_skew_angle()` — horizontal projection variance over ±5° in 0.1° steps on a downsampled binary copy. Only rotates if `abs(angle) >= 0.1`.
4. `ImageEnhance.Contrast(1.5)`
5. `UnsharpMask(radius=1.0, percent=50, threshold=3)`

`check_page_quality()` runs first: blank detection (>95% of pixels within 10 of median → skip), low resolution (<500px → warn), inverted scan (median <64 → warn).

### Phase 1b — Region detection (per page)

`detection/yolo_provider.py :: detect_image_regions()`. DocLayout-YOLO model `doclayout_yolo_docstructbench_imgsz1024.pt`, lazy-loaded and thread-locked (the model is not thread-safe).

- Inference at `imgsz=1024`, `conf=0.3`, `iou=0.3`
- Filter to class `figure` only (`YOLO_FIGURE_CLASSES = {"figure"}`)
- Area filter: `>= 15_000 px`, `<= 0.80 * page_area`
- Aspect ratio filter: `0.25 – 4.0`
- IoU-based NMS (`dedupe_overlapping_regions`, threshold 0.5)

Returns `list[tuple[y1, x1, y2, x2]]`.

### Phase 1c — DocAI text extraction (per page)

`recognition/docai_provider.py :: extract_page_text()`. Image is further prepared by `_prepare_image_for_docai()`:

1. CLAHE (`clipLimit=3.5`, `tileGridSize=8×8`)
2. Morphological opening with a 2×2 kernel
3. Border crop: Otsu threshold → bounding rect → 20 px margin
4. PNG encode; abort with `DocAIError` if encoded bytes exceed `DOCAI_MAX_BYTES = 18 MB`

Then call Google Cloud Document AI Layout Parser. Requires `GOOGLE_CLOUD_PROJECT` and `DOCUMENT_AI_PROCESSOR_ID`. Has its own retry loop independent of `shared/retry.py`: `max_retries=3` means 4 total attempts with delays 2s, 4s, 8s, 16s (`delay = 2 * (2 ** attempt)`), only for HTTP 429/500/503. HTTP 400 errors are treated as permanent and surface immediately as `DocAIError`.

Parses paragraph segments, extracts continuation markers via six regex patterns (`docai_provider.py` line ~39–46), extracts per-token confidence, computes `mean_confidence`.

### Phase 2 — Gemini page structuring (per page)

`recognition/page_extractor.py :: process_page_with_docai()`. Builds the prompt by injecting DocAI paragraphs into `DOCAI_SYSTEM_PROMPT`, sends the preprocessed PIL image as PNG bytes. Model: `gemini-3-flash-preview` with `thinking="high"`. `response_schema=PageContent` forces structured output.

After parsing:
1. `_sanitize_null_strings()` — clear literal `"null"`/`"none"` artifacts
2. `deduplicate_articles()` — sentence-overlap dedup
3. `postprocess_page_content()` — ad reclassification

**RECITATION handling**: if Gemini's content filter blocks the response with a `RECITATION` finish reason, the code retries by moving the OCR text from `system_instruction` to `user contents`. This is a documented SDK behavior: text in system instructions that is reproduced verbatim triggers the filter. Moving to user contents signals "data to process" rather than "text to recite."

Then `structure_and_link_page()` crops each YOLO region, calls `image_linking/visual_matcher.py :: match_images_visual()` for Gemini-based image assignment, or falls back to `image_linking/spatial_matcher.py :: match_images_to_articles()` (pure geometry).

### Phase 3 — Cross-page merging

`merging/llm_merge.py :: merge_edition_articles()`. The most algorithmically involved stage.

1. Collect all article dicts across pages: headline, author, body, continuation info, source page label.
2. `_deterministic_merge()` — exact-marker pairs are merged without the LLM.
3. Analyze dangling tails (body ends without terminal punctuation) and dangling heads (body starts lowercase or with connective words). If there are no candidates, **skip the LLM call entirely** and emit `MergeDecisions(groups=[])`.
4. Otherwise call Gemini Pro (`gemini-3.1-pro-preview`, `thinking="high"`) with `response_schema=MergeDecisions`.
5. On unparseable response, dump the raw blob to `snapshots/merge_raw_response.txt` and retry once with Flash (`gemini-3-flash-preview`).
6. Validate: article ids must be in-range and appear in exactly one group. Any article not referenced gets a singleton group appended.
7. For each multi-article group:
   - `_strip_continuation_markers()` — remove "(see p. 3)" / "(continued from p. 1)" regex patterns
   - `_validate_merge_seam()` — one-shot LLM call to repair torn sentences at the join
   - `_best_body()` — drop near-identical body segments (ratio > 0.7)
   - `clean_merge_boundary()` — mechanical cleanup per paragraph pair

**Confidence gate**: groups with `confidence < MERGE_MIN_CONFIDENCE` (default `0.5`, overridable) are split back into singletons. Setting `MERGE_MIN_CONFIDENCE=1.0` effectively disables LLM merges, leaving only the deterministic pre-merge.

### Phase 4 — Ad enrichment

`application/ad_enrichment.py :: enrich_edition()`. Reads `edition.json`, calls Gemini with `ENRICHMENT_SYSTEM_PROMPT` + `ENRICHMENT_USER_TEMPLATE`, receives `EnrichedAdsResponse`. Appends `enriched_ads` to the JSON via `tempfile.mkstemp()` + `os.replace()` — atomic on POSIX.

Non-fatal: any exception is caught and logged with `[cause=gemini_5xx_or_quota]` tagging for operator visibility; the edition keeps its un-enriched `ads`.

### Phase 5 — Content triage

`application/content_rescue.py :: triage_edition()`. Demotes "ghost" articles (matching ad-like patterns) and promotes real journalism trapped in `other_content`. Uses `TRIAGE_SYSTEM_PROMPT` + `TRIAGE_USER_TEMPLATE`. Atomic tempfile write, appends `content_triaged: true`.

Also non-fatal.

### Phase 6 — Write artifacts

1. `align_existing_image_files()` — drop any image paths that no longer exist on disk
2. `_sanitize_merged_articles()` — final null-string + whitespace pass
3. `json.dump(payload, indent=2)` → `public/editions/<date>/edition.json`
4. `write_diagnostics_json()` → `ocr/runs/<date>/diagnostics.json`
5. `_build_issue_report()` + `_write_issue_report_files()` → `issue_report.json` + `issue_report.md`

---

## LLM integration

All Gemini calls go through `shared/retry.py :: gemini_generate_with_retry()`.

Model and thinking levels live in `ocr/src/prompts.json`:

| Role | Model | Thinking |
|---|---|---|
| `page_structuring` | `gemini-3-flash-preview` | `high` |
| `image_matching` | `gemini-3-flash-preview` | — |
| `merge` | `gemini-3.1-pro-preview` | `high` |
| `merge_fallback` | `gemini-3-flash-preview` | — |
| `seam_repair` | `gemini-3-flash-preview` | `high` |
| `ad_enrichment` | `gemini-3-flash-preview` | — |
| `content_triage` | `gemini-3-flash-preview` | — |

All calls use `response_mime_type="application/json"` with a typed `response_schema`, except seam repair which returns either free text or the literal string `"VALID"`.

### Retry policy

Defined in `shared/retry.py`:

| Constant | Value | Meaning |
|---|---|---|
| `_MAX_RETRIES` | 4 | Up to 5 total attempts |
| `_BASE_DELAY_S` | 2 | 2s, 4s, 8s, 16s exponential |
| `_CALL_SPACING_S` | 0.5 | Applied before **every** call including attempt 0 (env-overridable) |
| `_REQUEST_TIMEOUT_S` | 120 | Per-call timeout (env-overridable) |
| `_RETRY_MODEL` | `merge_fallback` | **On any retry, the model is switched** |

The retry-model swap is a subtle behavior: **any retry** (not just the last) uses `gemini-3-flash-preview` even if the original call was for `gemini-3.1-pro-preview`. This degrades output quality but avoids repeated rate-limit hits against the Pro quota. If a Pro merge fails on attempt 1, all subsequent attempts 2–5 run on Flash.

**Retryable conditions**: transient network/quota errors — HTTP 429/500/503, typed SDK transient errors, and timeouts. HTTP 400 surfaces immediately.

Per-call timeout is enforced by wrapping the call in a single-worker `ThreadPoolExecutor` future with a 120s `.result(timeout=...)`. A long Gemini hang cannot block the whole run beyond this budget.

---

## Failure modes

There is no shared exception hierarchy. `DocAIError` (subclass of `Exception`, at `docai_provider.py:23`) is the only domain-specific exception; everything else propagates as generic `Exception` and is caught at phase-level try/except blocks.

| Phase | Error class | Handling | If you see this in production |
|---|---|---|---|
| 0 | `RuntimeError` | Not caught — aborts whole run | TIF conversion failed; usually disk-full or corrupt scan. Check `ocr/inbox/<date>/` |
| 1 (DocAI) | `DocAIError` | Caught per-page; logged to `PageDiagnostics.error`; page skipped. If **all** pages fail Phase 1, pipeline writes diagnostics and returns early | Check DocAI quota and `GOOGLE_CLOUD_PROJECT`; review `snapshots/docai_pageN.json` |
| 1 (general) | `Exception` | Same as `DocAIError` — per-page skip | Check `issue_report.md` for the page-specific message |
| 2 (Gemini) | `Exception` | Caught per-page; `structure_and_link_page()` returns `None`; page silently skipped | Check Gemini quota; inspect `raw_gemini_pageN.json` |
| 3 (merge) | `TimeoutError` | Warning, returns `None`, pipeline falls back to unmerged articles | Lower `--workers`, check Pro quota, inspect `merge_raw_response.txt` |
| 3 (merge) | `Exception` | Same as TimeoutError | Review `merge_decisions.json` if present |
| 4 (enrich) | `Exception` | Non-fatal; edition keeps un-enriched `ads`; logged with cause tag | Re-run just Phase 4: `python ocr/enrich_ads.py <date>` |
| 5 (triage) | `Exception` | Non-fatal; edition keeps untriaged content | Inspect logs for `[cause=...]` tag |
| 6 (write) | `Exception` | Propagates — write failure is fatal | Check disk space on `public/editions/` |

Errors surface through three channels:

1. **`PageDiagnostics.error`** — triggers an `ISSUE-NNN` entry with `root_cause_type="bug"` in `issue_report.json`.
2. **`MergePassDiagnostics.error`** — similarly flagged.
3. **`warning()` / `error()` console output** via Rich.

The shell wrapper `scripts/ocr/process-edition.sh` checks the Python exit code: OCR exit 0 is required, else the wrapper itself exits 10. The Python process does **not** exit with non-zero on partial failures — page skips and failed enrichment are "successful" from the shell's view.

---

## Diagnostics & observability

All files written to `ocr/runs/<edition_date>/` (or `ocr/runs/<edition_date>/runs/<run_id>/` when `--run-id` is given).

| Artifact | Written by | Contents |
|---|---|---|
| `run_manifest.json` | `diagnostics/run_manifest.py` | `run_id`, `edition_date`, `git_commit_hash`, per-input `{path, size, sha256}` |
| `snapshots/<name>.json` | `diagnostics/snapshots.py` | Intermediate stage dumps — one per page per stage + edition-level |
| `diagnostics.json` | `export/artifact_writer.py` | Full serialized `PipelineReport`: all page diagnostics, merge pass, token totals, elapsed time |
| `issue_report.json` / `.md` | `diagnostics/issue_report.py` | Post-run automated checks: per-page errors, category collapse, continuation marker loss, empty articles, image alignment mismatches, merge pass error |
| `summary.md` | `export/markdown_writer.py` | Human-readable edition summary |
| `pipeline-summary.json` | shell wrapper `on_exit` trap | Stage-level status + elapsed + counts |

Snapshot names (one per page, `N` is page number):
- `docai_pageN.json` — DocAI result
- `raw_gemini_pageN.json` — Gemini structuring raw response
- `post_dedup_pageN.json`, `post_process_pageN.json` — after postprocessing
- `image_matching_pageN.json`, `post_images_pageN.json` — after image assignment

Edition-level snapshots: `pre_merge_articles.json`, `merge_decisions.json`, `post_merge_edition.json`, `merge_raw_response.txt` (only on LLM parse failure).

---

## Cost & rate controls

The OCR pipeline has **no daily budget kill switch**. That mechanism lives on the RAG side only (`src/lib/cost-tracker.ts` + `ai_spend_counter` table, `$0.50/day` hard stop for `/api/ask`).

Token usage on the OCR side is tracked purely for observability. `PipelineReport.finalize()` sums `total_prompt_tokens` and `total_candidates_tokens` across all page diagnostics and the merge pass. These land in `diagnostics.json` and `pipeline-summary.json`. **They do not affect control flow** and are never persisted to the DB.

The only per-run rate controls are at the call level:

- `GEMINI_CALL_SPACING_S` — default 0.5s between every Gemini call (env-overridable)
- Exponential backoff retry on HTTP 429

If you run a large batch with default settings against cold quotas, you will hit 429s and lose wall-clock time to backoff, but no guardrail will stop you from running a $20 job accidentally. This is an intentional tradeoff — batch OCR is infrequent and interactive.

---

## Local dev workflow

### `process-edition.sh` — single edition

```bash
scripts/ocr/process-edition.sh ocr/inbox/1960-01-13 [--run-id baseline] [--from-stage N]
```

The wrapper:

1. Sources `.env.local`
2. Validates `GOOGLE_API_KEY` (hard-fail), `DATABASE_URL` (hard-fail at stage 4)
3. Activates `ocr/.venv/` (hard-fail if absent)
4. Creates `ocr/runs/<date>/` log directory

Then runs four stages, each gated by exit code:

| Stage | Command | Exit code on failure |
|---|---|---|
| 1 — OCR | `python ocr/convert_scans.py <path> --workers N` | `10` |
| 2 — Image cleanup | `node scripts/cleanup-images.mjs --apply --date <date>` | `20` |
| 3 — R2 upload | `node scripts/db/upload-images.mjs --date <date>` | `30` (skipped if R2 creds absent) |
| 4 — DB seed | `OCR_MIN_TEXT_LENGTH=0 npm run db:seed -- --date <date>` | `40` |

An `on_exit` trap writes `pipeline-summary.json` regardless of exit code. On success, the edition directory is moved from `ocr/inbox/` to `ocr/done/` (unless `--keep-source`).

### Required env vars

| Var | Purpose | Required? |
|---|---|---|
| `GOOGLE_API_KEY` | Gemini | **yes** |
| `DATABASE_URL` | Neon, for stage 4 | **yes** at stage 4 |
| `GOOGLE_CLOUD_PROJECT` | DocAI | **yes** |
| `DOCUMENT_AI_PROCESSOR_ID` | DocAI | **yes** |
| `DOCUMENT_AI_LOCATION` | DocAI | no (default `us`) |
| `R2_ACCOUNT_ID`, `R2_BUCKET_NAME` | R2 upload | no (stage 3 skipped) |
| `OCR_WORKERS` | Parallel workers for Phase 1+2 | no (default 1) |
| `GEMINI_REQUEST_TIMEOUT_S` | Per-call timeout | no (default 120) |
| `GEMINI_CALL_SPACING_S` | Gap between calls | no (default 0.5) |
| `MERGE_MIN_CONFIDENCE` | Merge gate threshold | no (default 0.5) |

### `process-unprocessed.sh` — batch

Discovers subdirectories in `ocr/inbox/`. Sequential mode iterates serially; `--parallel N` uses `xargs -P N` to run N concurrent `process-edition.sh` processes with per-edition result files, then aggregates into `ocr/runs/batch-<timestamp>.json`.

---

## Testing

All tests under `tests/ocr/`. Run with:

```bash
python -m pytest tests/ocr/ -x
```

The venv is auto-activated by the shell wrappers; for a manual pytest invocation, source `ocr/.venv/bin/activate` first.

### Architecture tests (`tests/ocr/architecture/`)

Purely static, no heavy imports.

- `test_import_rules.py` — uses `ast.parse` to enforce the import layering rules. Covers:
  - `contracts` cannot import any domain layer
  - `shared` cannot import any domain layer
  - Stage modules cannot import `application`
  - `evaluation` cannot import `application`
  - `docai_provider` cannot import `google.genai`, `page_extractor`, or `shared.retry` (enforces DocAI/Gemini separation)
  - Wrapper files `ocr/convert_scans.py` and `ocr/enrich_ads.py` must import their respective `cli.*` module
- `test_wrapper_entrypoints.py` — subprocess `--help` smoke tests
- `test_runtime_cutover.py` — verifies default usage strings

### Behavior tests

| File | Target |
|---|---|
| `test_failure_paths_static.py` | monkeypatch-based integration: visual→spatial fallback; DocAI failure cleanup |
| `test_continuation.py` | `_extract_continuation_info`, `_strip_continuation_markers` — garbled OCR, bidirectional cases |
| `test_boundary_cleanup.py` | `clean_merge_boundary` — truncated words, duplicate sentences, edge cases |
| `test_byline_cleanup.py` | byline normalization and author/position splitting |
| `test_merging.py` | `_validate_merge_seam` with `unittest.mock.patch` on the Gemini call |
| `test_docai_provider.py`, `test_prepare_image_for_docai.py` | DocAI unit tests |
| `test_null_sanitizer.py`, `test_region_filters.py`, `test_artifact_schema_contracts.py`, `test_best_body.py`, `test_page_quality.py`, `test_image_converter.py`, `test_merge_helpers.py` | Targeted helper coverage |

### Golden regression

The gold edition lives at `gold/1960-01-13/gold-edition.json`. The scorer is `ocr/src/transcript_ocr/evaluation/gold_score.py`.

To run:

```bash
# 1. OCR the edition
scripts/ocr/process-edition.sh ocr/inbox/1960-01-13 --run-id baseline

# 2. Score
python ocr/src/transcript_ocr/evaluation/gold_score.py \
  --gold-dir gold/1960-01-13/ \
  --run-dir  ocr/runs/1960-01-13/runs/baseline/
```

The scorer computes word-level edit distance (WER, missing-word rate, extra-word rate) per page and in aggregate. Note: the scorer expects `page*.reference.txt` files in the gold directory. Only `gold-edition.json` and images are checked in — reference transcripts are created per-run as needed.

---

## Architecture invariants (CI-enforced)

`.github/workflows/ocr-architecture.yml` runs on every PR and push.

**Job 1 — Import boundaries**: `pytest -q tests/ocr/architecture/`. AST-based, no imports executed.

**Job 2 — Script target validation**: inline Python checks that these five paths exist and haven't been silently moved:

- `ocr/convert_scans.py`
- `ocr/enrich_ads.py`
- `scripts/dev/compare_runs.py`
- `scripts/ocr/process-edition.sh`
- `scripts/ocr/process-unprocessed.sh`

Any refactor that moves these files without updating the wrapper will fail CI before it ever hits runtime.

---

## Gotchas

- **Retry model swap**. On any retry attempt, `gemini_generate_with_retry` switches to `_RETRY_MODEL` (currently `gemini-3-flash-preview`) regardless of the caller's original request. A failed `gemini-3.1-pro-preview` merge will retry on Flash with different quality characteristics.
- **Layered fallback at merge**. The retry system switches to Flash on transient errors. In addition, `llm_merge.py` has an explicit inner fallback that retries with `merge_fallback` specifically when `response.parsed` is falsy. These can stack: up to 5 attempts × 2 fallback layers.
- **ThreadPoolExecutor in both Phase 1 and 2**. With `workers > 1`, DocAI and Gemini structuring run concurrently. The YOLO model uses a `threading.Lock()` because the model is not thread-safe; YOLO inference is serialized even inside a parallel worker pool.
- **Memory pressure**. Preprocessed PIL images accumulate in a `docai_results` dict across Phase 1, then cleared after Phase 2. A 12-page edition at ~8MP/page is roughly 96 MB held simultaneously with `workers=1`. Scale accordingly with higher worker counts.
- **DocAI 18 MB cap**. `_prepare_image_for_docai()` raises `DocAIError` if the encoded PNG exceeds 18 MB. DocAI's real limit is 20 MB; the 2 MB buffer is a margin of safety. High-resolution grayscale scans can hit this.
- **Atomic JSON writes**. Phases 4 and 5 both use `tempfile.mkstemp()` + `os.replace()` with distinctive prefixes (`ads_`, `rescue_`) to prevent file-name collisions if two processes run against the same edition concurrently.
- **RECITATION retry**. Gemini's content filter blocks verbatim reproduction of text in system instructions. The page-structuring stage retries with the OCR text moved from `system_instruction` to user contents. Know this before adding new system-instruction text.
- **`"?"` continuation semantics**. Both `_extract_continuation_info()` and the DocAI path normalize non-numeric page references ("back page", "next page") to `"?"`. The LLM merge prompt explicitly says `"?"` means uncertain — only merge if body content confirms. This prevents false positives on ambiguous markers.
- **`MERGE_MIN_CONFIDENCE` disables merge**. Setting the env var to `1.0` keeps only the deterministic pre-merge pass and skips LLM groups entirely. Useful for debugging bad merges.
- **No reference transcripts in repo**. `gold/1960-01-13/` ships only `gold-edition.json` and images. Per-page `page*.reference.txt` files must be produced by an operator before the scorer can run.
- **Run manifest timing**. The manifest is computed *after* Phase 0 converts TIFs to PNGs. The SHA256 values cover the final PNGs, not the original TIFs. If you need to audit the original TIFs for a run, keep them outside the pipeline.

---

## Start here

If you're new to the pipeline and need to make a change, read these five files in order:

1. `scripts/ocr/process-edition.sh` — the end-to-end shell wrapper
2. `ocr/src/transcript_ocr/application/edition_pipeline.py` — phase orchestrator
3. `ocr/src/transcript_ocr/contracts/content_models.py` — the data shapes that flow between phases
4. `ocr/src/transcript_ocr/shared/retry.py` — the Gemini retry + model-fallback policy every LLM caller depends on
5. `ocr/src/prompts.json` — model assignments and prompt text

Then consult `.github/workflows/ocr-architecture.yml` for the CI invariants before refactoring any layer.
