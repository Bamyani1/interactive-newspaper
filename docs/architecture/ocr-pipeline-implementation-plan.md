# OCR Pipeline Implementation Plan

Status: implemented and verified against the frozen 1990-02-21 calibration edition.

## Scope and invariants

This plan replaces the OCR pipeline internals without changing the public edition schema, database schema, embeddings, vector indexes, `/ask`, retrieval, ranking, or the existing 1960 gold baseline. Production OCR uses Vertex AI through Application Default Credentials, the `global` location, and the stable `v1` API. API-key authentication and cross-model fallback are not supported.

The manifest canvas count is always the edition denominator. Every canvas ends in exactly one state: `passed_content`, `passed_visual`, `confirmed_blank`, or `failed`. An edition may publish when `(passed_content + passed_visual + confirmed_blank) / manifest_canvas_count >= 0.70`. Missing downloads, conversion errors, Document AI failures, and Gemini API/schema failures are `failed`; they must never be reinterpreted as blank. A page is not skipped before cloud processing based only on pixel heuristics.

## Model routing and request policy

| Call | Model | Thinking | Media |
|---|---|---|---|
| Page structuring | `gemini-3.5-flash-lite` | `HIGH` | Page image `ULTRA_HIGH` |
| Visual assignment | `gemini-3.5-flash-lite` | `MEDIUM` | Every image part `ULTRA_HIGH` |
| Article grouping | `gemini-3.6-flash` | `MEDIUM` | None |
| Seam review | `gemini-3.6-flash` | `MEDIUM` | None |
| Ad enrichment | `gemini-3.5-flash-lite` | `MINIMAL` | None |
| Final content review | `gemini-3.5-flash-lite` | `MEDIUM` | None |

All calls use one candidate, seed `0`, disabled safety filters, and `include_thoughts=false`. Gemini 3 requests omit temperature, top-p, top-k, and thinking budgets. A stage invocation gets at most three total API attempts. Transient retries and the single permitted schema-correction retry consume the same budget, keep the exact model/configuration, and never switch models.

Pricing telemetry uses global standard rates: Gemini 3.5 Flash-Lite `$0.30/M` input and `$2.50/M` output; Gemini 3.6 Flash `$1.50/M` input and `$7.50/M` output. Tool-use prompt tokens count as input and thought tokens count as output.

## Ingestion and preprocessing

Downloads are manifest-driven and atomic through `.part` files. TIFF conversion processes every frame losslessly and verifies decoded pixels before accepting the result. Each page has an EXIF-normalized, native-resolution color source master with transparency flattened onto white, plus a separate 8-bit grayscale lossless PNG OCR derivative.

Deskew searches `-2.0` through `+2.0` degrees in `0.1` degree increments. Rotation occurs only when the absolute best angle is at least `0.2` degrees, using bicubic resampling, canvas expansion, and a white fill. A score optimum on either search boundary produces a warning and no rotation. The OCR derivative receives no resize, upscale, contrast adjustment, sharpening, CLAHE, morphology, binarization, or automatic border crop. Detection and crops use the color source master; Document AI and page structuring use the OCR derivative.

Document AI uses the processor version alias `/processorVersions/stable`. Processor, project, and location must be explicit; no historical pinned version is used.

## Page structuring and text preservation

The Document AI transcript is the text source of truth. Historical text receives only whitespace/line-wrap normalization and conservative line-end dehyphenation. There is no title-case modernization, summarization, author/title inference, or article/ad regex classification. Authors omit a leading `By`; writer positions remain separate.

Only consecutive, exactly equal normalized paragraphs are deduplicated. Sentences are never deduplicated. Cross-page duplicate articles are removed only when normalized headline and body both match exactly. Missing or unsupported article categories deterministically fall back to `News` and enter targeted final review. Publication information is combined in page order with exact deduplication.

## Visual detection and assignment

The hosted detector configuration uses the American Stories layout detector as primary and DocLayout for table fallback, subject to an explicit deployment-license gate for both American Stories and AGPL DocLayout-YOLO. Detector source, class, confidence, and bounds are preserved through class-aware fusion. Thresholds are deterministic and calibrated on the frozen 1990 gold edition.

The visual call receives the full annotated source page plus crops padded by 10%, with at most 40 region crops per request. If batching is required, the full page is repeated and every image part is set to `ULTRA_HIGH`. Every proposal must receive exactly one disposition. Ad visuals below 40,000 pixels receive the explicit `rejected_small_ad_visual` disposition. Invalid, missing, or duplicate assignments consume the one schema retry; exhaustion produces `standalone/unresolved`. There is no spatial semantic fallback.

Visual kind and content attachment are independent. Printed caption slots are page-local and authoritative; Gemini may associate a slot but may not generate archival captions. Every visual is attached to an article, attached to an ad, retained as standalone content, rejected by policy, or marked unresolved.

## Article grouping and seam review

Article fragments receive deterministic run-local IDs. One edition-level Gemini 3.6 Flash call decides all candidate groups and returns a complete partition of every provided fragment into ordered merge groups, including singleton groups. The model returns IDs and decisions only, never rewritten article text or metadata. Non-singleton grouping requires a structured continuation signal, but printed folio digits are evidence rather than a Python veto because the source newspaper can misprint them. Python validates the partition and presence of continuation roles, then mechanically selects the earliest non-empty metadata while preserving all bodies, images, and source pages.

One edition-level seam call checks every adjacent boundary in every accepted group regardless of punctuation or capitalization. A group `A,B,C` therefore submits `A→B` and `B→C` in the same call. Each boundary returns `KEEP`, `REPAIR`, or `UNRESOLVED`. Repair anchors are checked independently at at least 90% normalized-word similarity, must uniquely match the left suffix and right prefix, and may not change names, numbers, dates, prices, or phone numbers. An invalid boundary makes the whole group fall back losslessly to its original fragments. `UNRESOLVED` preserves original text with a paragraph break. Missing pages do not delete surviving content or independently block publication when the 70% rule still passes.

## Enrichment and final review

Ad enrichment runs once per edition, split deterministically only above 50 ads. It returns source-supported deltas only; original business name, body, images, and source pages remain immutable. Failure leaves raw ads unchanged.

Final review receives only deterministic candidates: category fallbacks, exact cross-array text duplicates, blank article headline/body shapes, blank ad business/body shapes, visual-kind conflicts, and explicit unresolved classification states. It may change only item type and category, only at confidence `>=0.90`, and may not rewrite text, names, metadata, source pages, or image associations. Schedules and standings remain other content unless they are authored journalism. Review failure is an abstention.

## Assets, artifacts, and promotion

Only referenced public images are retained. Images are encoded as WebP, never enlarged, with a 2,000-pixel maximum long edge. Encoding tries quality 85, 80, and 75, then reduces dimensions by 10% steps to a 1,400-pixel floor unless the source is smaller. Each asset must remain below 500 KiB. The edition warns above 15 MiB and fails above 25 MiB. Asset names and R2 keys are hashes of the final WebP bytes.

The durable OCR artifacts are only the current public edition, its current `provenance.json`, its current `asset-manifest.json`, and the global append-only `ocr/logs/failures.jsonl`. Prompts, OCR text, raw responses, snapshots, issue reports, per-run directories, and historical candidates are not retained. Failure records contain sanitized metadata only: edition/canvas/page, stage/attempt, model/config identifiers, status/finish reason, latency, token categories, estimated cost, and error.

Promotion stages on the same filesystem under an edition lock. Assets upload first; failed references are pruned, image-only empty standalone records are removed, text-bearing records are preserved, and structural validation runs again. Public promotion is an atomic rename with a temporary rollback directory that is deleted immediately after verification. Both successful and fatal runs remove all run-owned downloads, derivatives, crops, and candidates.

A scheduled manifest-aware R2 lifecycle job reads every current public asset manifest and deletes only hashes that have been globally unreferenced for at least 30 days. Per-edition processing never deletes shared hash objects.

The default CLI performs OCR, R2 upload, and atomic public promotion. Database seeding is opt-in through `--seed`, and `DATABASE_URL` is required only then. OCR-stage `--from-stage` resumption is removed; post-public upload or seed repair may operate only on an already validated public artifact.

Recoverable outcomes include tolerated page failures, unresolved visual assignments, grouping/seam fallback, enrichment fallback, final-review abstention, and individual asset-upload pruning. Fatal outcomes are a pass ratio below 70%, structural invalidity, a public asset total above 25 MiB, missing required cloud configuration, or promotion failure.

## Verification

Unit and invariant tests cover exact model routing, thinking/media settings, retry ceilings, token-cost accounting, state transitions, text preservation, complete visual dispositions, merge partition validation, all-boundary seam batching, anchor validation, image sizing, R2 pruning, atomic promotion, and the no-debug-artifact rule. Failure injection verifies lossless fallbacks and cleanup.

ADC smoke tests cover all Gemini models/configurations and Document AI stable. The frozen February 21, 1990 gold edition is the calibration and regression reference; two varied holdout editions use the exact detector mode intended for hosted deployment. Extraction quality is reported precisely without a hidden pass threshold. RAG behavior and its existing tests remain unchanged.

## Implementation verification snapshot

The extraction-only calibration run processed all 12 manifest canvases with ADC, Vertex AI `v1`, the `global` location, Document AI stable, and the model routing above. The candidate passed structural validation and was neither published nor seeded. Manually reviewed final-artifact mapping measured article precision/recall/F1 of `0.943/1.000/0.971`, ad precision/recall/F1 of `1.000/0.889/0.941`, and other-content precision/recall/F1 of `0.579/0.917/0.710`. The run exposed incorrect printed folio references in the source newspaper; grouping now treats those digits as evidence for Gemini rather than a Python veto while continuing to require structured continuation roles.
