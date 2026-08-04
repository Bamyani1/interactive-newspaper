# OCR Pipeline Architecture

This document describes the production OCR path that converts a newspaper
edition into the current public `edition.json` contract. The RAG pipeline is
outside this scope and remains unchanged.

## System boundary

Input is an edition directory whose name contains `YYYY-MM-DD`. An IIIF
manifest is authoritative when present; otherwise the pipeline creates a
non-authoritative synthetic inventory from naturally sorted local images.
Production downloads persist `source-manifest.json`, so the manifest canvas
count—not the number of downloaded files—is normally the edition denominator.

Output is a validated candidate containing articles, ads, other content,
publication information, provenance, and referenced image assets. The Python
orchestrator never writes directly over the current public edition. The shell
publisher owns asset upload, the final validation, and atomic promotion.

```text
IIIF manifest + page scans
          |
          v
manifest inventory -> lossless source conversion -> per-page image branches
          |                                      /                 \
          |                         grayscale OCR derivative   color source master
          |                                   |                     |
          |                             Document AI        hybrid visual detector
          |                                   \                     /
          |                                    Gemini page structuring
          |                                             |
          v                                             v
canvas state accounting <----------------------- visual dispositions
          |
          v
edition grouping -> all-boundary seam review -> enrichment -> final review
          |
          v
validate -> optimize/upload referenced assets -> validate -> atomic promotion
```

## Manifest accounting and publication gate

Every expected canvas reaches exactly one terminal state:

| State | Meaning | Counts toward 70% |
|---|---|---|
| `passed_content` | Structured historical text is present | yes |
| `passed_visual` | No historical text, but a retained visual is present | yes |
| `confirmed_blank` | Successful cloud processing found neither content nor a retained visual | yes |
| `failed` | Missing download, conversion failure, or unrecovered cloud/schema failure | no |

The publication ratio is:

```text
(passed_content + passed_visual + confirmed_blank) / manifest_canvas_count
```

The candidate may continue when the ratio is at least `0.70`. A blank-looking
pixel histogram produces only a warning; it never skips cloud processing or
turns an API failure into `confirmed_blank`. Missing pages consume their canvas
state but do not erase the content extracted from surviving pages.

## Transaction and ownership

`application.edition_pipeline.process_edition()` builds one candidate under the
root supplied by the caller. `scripts/ocr/process-edition.sh` creates that root
on the same filesystem as `public/editions/`, holds an edition-specific lock,
and performs the transaction:

1. Build the isolated OCR candidate.
2. Structurally validate `edition.json` and every referenced local image.
3. Optimize and upload only referenced assets.
4. Prune failed image references while retaining text-bearing records.
5. Validate the modified candidate again.
6. Move the prior public edition into a temporary rollback directory.
7. Rename the candidate to the public path.
8. Validate the public result and delete the rollback directory.

If promotion fails, the wrapper restores the previous public edition. Database
seeding is a separate opt-in operation after promotion. So is the Phase 4
versioned DB publication (`npm run db:publish-edition`), which stages the
promoted artifact into immutable revision tables under a resumable publication
run; see [data-model.md](data-model.md). A publication repair can re-run
upload or seeding only from an already validated public artifact; there is no
OCR-stage resume mode — the versioned publisher's `--resume` resumes only
database-side publication runs.

## Ingestion and image branches

### Download and inventory

`scripts/iiif/download.py` supports IIIF Presentation 2 and common Presentation
3 shapes. It records every canvas, preserves missing-download outcomes, assigns
a four-digit canvas prefix, verifies each image, and renames a `.part` file only
after successful decode. `ingestion.manifest.discover_page_inventory()` rejects
duplicate local files for one canvas, unnumbered files in manifest mode, and
extra files that do not map to a canvas.

### TIFF conversion

`preprocessing.image_converter` decodes every frame in every TIFF. Each frame is
written to PNG staging, reopened, and checked for matching dimensions, decoded
sample shape and type, exact pixel values, and palette appearance where
applicable. The TIFF is deleted only after all committed frames pass a second
verification. A bad TIFF fails only its mapped canvas; other canvases continue.

### Source master and OCR derivative

`preprocessing.image_preprocessor` creates two explicit run-scoped files:

- **Source master:** native-resolution, EXIF-normalized color; transparency is
  composited on white. Detection and all public crops use this branch.
- **OCR derivative:** lossless 8-bit grayscale. Document AI and Gemini page
  structuring use this branch.

Deskew uses a fixed projection-profile search from `-2.0` to `+2.0` degrees in
`0.1`-degree increments. It rotates only when the best absolute angle is at
least `0.2` degrees. A best score at either boundary is considered unreliable
and leaves the page unrotated. Applied rotations use bicubic resampling, canvas
expansion, and white fill.

No stage applies resize, upscale, contrast enhancement, sharpening, CLAHE,
morphology, binarization, or automatic border crop to the OCR derivative.
Document AI transport only encodes those pixels as lossless PNG.

## Document AI

`recognition.docai_provider.extract_page_text()` calls Enterprise OCR using:

- `GOOGLE_CLOUD_PROJECT`
- `DOCUMENT_AI_PROCESSOR_ID`
- `DOCUMENT_AI_LOCATION`
- `/processorVersions/stable`

It returns raw text, paragraph anchors, token confidence, and low-confidence
words. Empty text is a valid response because a page can be visual-only or
blank. Continuation-marker regex extraction is disabled: raw printed markers
remain in the transcript, while semantic continuation decisions belong to the
page-structuring and grouping contracts.

Document AI has three total attempts for transient failures. Permanent client
errors surface immediately. A failed final attempt marks the canvas `failed`.

## Local visual detection

The locked detector is `hybrid`:

1. The American Stories ONNX newspaper-layout checkpoint proposes photograph
   and cartoon/advertisement regions from the color source master.
2. DocLayout-YOLO proposes table regions.
3. A table is added only when it does not overlap an American Stories region at
   or above the fixed IoU threshold.

The American Stories model runs at 1280 square input, confidence `0.1`, and
class-agnostic NMS IoU `0.1`. Shared region policy rejects boxes below 15,000
pixels, above 80% of page area, or outside the `0.25` to `4.0` aspect-ratio
range. Detector source, class, confidence, and bounds remain available in the
run's in-memory diagnostics.

Hosted execution requires an explicit `OCR_DETECTOR_LICENSES_ACCEPTED=true`
acknowledgement because American Stories and DocLayout have separate deployment
license obligations. The detector route is fixed; environment overrides cannot
bypass American Stories or its DocLayout table fallback.

## Gemini request policy

All OCR Gemini clients are created in `config.google_clients` with Vertex AI,
ADC, project `GOOGLE_CLOUD_PROJECT`, location `global`, API `v1`, and SDK-level
automatic retries set to one attempt so the pipeline owns retry behavior.

Stage settings live in `ocr/src/prompts.json` and are normalized by
`config.model_calls`:

| Stage | Model | Thinking | Max output | Timeout | Media |
|---|---|---|---:|---:|---|
| Page structuring | `gemini-3.5-flash-lite` | `HIGH` | 65,536 | 240 s | OCR page `ULTRA_HIGH` |
| Visual assignment | `gemini-3.5-flash-lite` | `MEDIUM` | 65,536 | 180 s | annotated page and crops `ULTRA_HIGH` |
| Article grouping | `gemini-3.6-flash` | `MEDIUM` | 65,536 | 240 s | none |
| Seam review | `gemini-3.6-flash` | `MEDIUM` | 65,536 | 240 s | none |
| Ad enrichment | `gemini-3.5-flash-lite` | `MINIMAL` | 65,536 | 120 s | none |
| Final content review | `gemini-3.5-flash-lite` | `MEDIUM` | 16,384 | 120 s | none |

Every request uses:

- one candidate;
- seed `0`;
- `include_thoughts=false`;
- safety thresholds `OFF` for the configured harm categories;
- typed JSON response contracts where applicable;
- no `temperature`, `topP`, `topK`, or thinking-budget override.

`shared.retry.gemini_generate_with_retry()` owns a single three-attempt budget.
Transient transport failures and the one allowed invalid-schema correction
consume the same budget. Retries preserve the exact model, thinking level,
media resolution, prompt, and response schema. There is no fallback model.
Request starts are globally spaced by 0.5 seconds by default; responses may
still overlap across page workers.

## Page structuring and historical text

`recognition.page_extractor` sends the Document AI paragraphs and the grayscale
page to Gemini 3.5 Flash-Lite. The transcript is the text source of truth; the
image supplies layout, reading order, and printed-caption placement.

The output `PageContent` contains `articles`, `ads`, `other_content`,
`page_number`, and `publication_info`. Article categories are restricted to:

- `Campus News`
- `News`
- `Sports`
- `Arts & Entertainment`
- `Opinion`

An invalid or unsupported category becomes `News`. Historical content permits
only whitespace/line-wrap normalization and conservative obvious line-end
dehyphenation. Leading `By` is removed from the author field; a printed writer
position stays separate. The pipeline does not modernize capitalization,
summarize, infer missing authors or titles, or use local price/phone regexes to
decide article versus ad.

Deduplication is deliberately narrow:

- only consecutive exactly equal normalized paragraphs are removed inside a
  body;
- exact duplicate page records require both normalized headline and body;
- edition-level article deduplication also requires an exact normalized
  headline-and-body pair;
- repeated sentences and non-adjacent repeated text are preserved.

Publication information is combined in page order with exact duplicate values
removed.

## Visual assignment and captions

`application.page_pipeline.structure_and_link_page()` creates 10%-padded clean
crops and an annotated full source page. `image_linking.visual_matcher` sends
the full page plus at most 40 requested region crops per call; the full page is
repeated when multiple batches are necessary. Every image part is
`ULTRA_HIGH`.

For every global region ID, Gemini returns two independent decisions:

- visual kind: photograph, illustration, table/chart/map, logo, typographic
  display ad, plain text, scanner/decorative artifact, or unresolved;
- attachment: article, ad, standalone, or reject.

Each batch must return exactly one valid disposition per requested ID. The one
schema-correction retry handles missing, duplicate, out-of-range, or invalid
assignments. Exhaustion converts the affected batch to unresolved standalone
evidence; geometric proximity never makes a semantic attachment.

The model cannot generate archival captions. Page structuring creates slots
only from printed caption text in the OCR transcript, and visual assignment may
associate a region with one of those slots. Unused printed caption text remains
in `other_content`, so a detector miss cannot silently delete it.

An ad attachment below 40,000 pixels is deterministically changed to
`rejected_small_ad_visual`; this prevents dots or tiny artifacts from becoming
public ad images. Other retained crops are attached to an article, attached to
an ad, or preserved as standalone content.

## Article grouping and seam review

`merging.llm_merge.merge_edition_articles()` is lossless by construction.

### Grouping call

Each available article fragment gets an immutable run-local ID. One
edition-level Gemini 3.6 Flash call receives every fragment with page,
headline/byline fields, structured continuation fields, first and last two
sentence-like units, and bounded raw head/tail fallbacks. It must return a
complete partition of all IDs, including singleton groups, in merge order. It
does not return rewritten text or metadata.

Python validates exact coverage, uniqueness, known IDs, and the presence of a
structured continuation role for every edge in a multi-fragment group. Printed
folio digits remain evidence for Gemini rather than a Python veto because the
source newspaper can misprint them. Python does not use punctuation,
capitalization, body-similarity, or continuation regexes to preselect calls or
make semantic grouping decisions. An invalid partition becomes all singletons.

### Seam call

Every adjacent boundary in every accepted multi-fragment group is included in
one edition-level Gemini 3.6 Flash request, regardless of punctuation or
capitalization. A three-piece article contributes two boundary records, but not
two API calls. Each boundary returns:

- `KEEP`: join the unchanged fragments with a paragraph break;
- `REPAIR`: replace only a local left suffix and right prefix;
- `UNRESOLVED`: preserve the default paragraph-break join without guessing.

Repair anchors must match the source edge uniquely at 90% or greater normalized
word similarity. The replacement must also remain at least 90% similar and
preserve protected names, numbers, dates, prices, and phone-number tokens. A
missing, duplicate, or unsafe boundary decision makes only that merge group
fall back to its original source fragments. Accepted groups mechanically keep
the earliest non-empty metadata and preserve every body, image, and source page.

## Ad enrichment and final review

Ad enrichment uses Gemini 3.5 Flash-Lite once per edition, split only when the
edition has more than 50 ads. The model returns deltas keyed by stable ad IDs.
`business_name`, source body, and image files are copied from the original ad
and cannot be rewritten. Phone, address, and price must be found in that ad's
source text; unsupported values are cleared. An unsupported generated display
summary is also cleared. Any failed or incomplete batch leaves all raw ads
unchanged.

The final review does not inspect every item. Deterministic code selects only:

- category-fallback flags;
- exact text duplicated across content arrays;
- blank article headline/body shapes;
- blank ad business/body shapes;
- visual-kind conflicts;
- explicit unresolved classification states.

Gemini 3.5 Flash-Lite may change only item type or article category, and a
decision is applied only at confidence `>= 0.90`. It cannot rewrite text,
names, metadata, source pages, captions, or image associations. Schedules and
standings remain other content unless the supplied evidence shows authored
journalism. Failure or an incomplete response is an abstention.

## Candidate validation and assets

`export.validation` checks, among other invariants:

- matching edition date and required arrays;
- valid article categories and source pages;
- aligned `images` and `image_files` arrays;
- safe, existing referenced paths;
- one-to-one alignment of raw and enriched ads;
- immutable enriched-ad source fields;
- valid continuation fields and control characters;
- no exact duplicate long articles.

`scripts/db/upload-images.mjs` keeps only referenced images. It encodes WebP
without enlargement, caps the long edge at 2,000 pixels, tries quality 85, 80,
and 75, and then reduces dimensions by 10% to a 1,400-pixel floor when needed.
Each asset must be below 500 KiB. The public edition warns above 15 MiB and
fails above 25 MiB. SHA-256 of the final WebP bytes determines both
`images/<hash>.webp` and `ocr-assets/<hash>.webp` in R2.

Missing or unencodable images are pruned from aligned references before the
second validation. An image-only standalone record is removed when its asset
fails; printed text is retained even when its visual reference is lost.

R2 cleanup is separate from edition publication. `scripts/db/gc-r2-assets.mjs`
reads every current `asset-manifest.json`, tracks globally unreferenced object
hashes in the private `ocr-assets-gc/unreferenced.json` state object, and
deletes them only after they have remained unreferenced for a grace period of
at least 30 days. Object modification time is not treated as the start of the
unreferenced period. It is a dry run unless `--apply` is supplied.

## Durable artifacts and observability

The durable artifacts are limited to:

```text
public/editions/<date>/edition.json
public/editions/<date>/provenance.json
public/editions/<date>/asset-manifest.json
public/editions/<date>/images/<sha256>.webp
ocr/logs/failures.jsonl
```

`provenance.json` records the source manifest reference, per-canvas terminal
state and source hash, Google Cloud project/location/API mode, Document AI
`stable`, and model routing.

The append-only failure log contains sanitized metadata fields such as edition,
canvas/page, stage, attempt, model/config ID, finish reason, latency, token
categories, estimated cost, and a bounded error string. It contains no prompt,
OCR transcript, image, raw model response, or absolute local path.

Snapshot, raw-response, issue-report, and run-comparison helpers have been
removed. Run-owned source masters, OCR derivatives, annotated pages, crops,
candidates, and rollback directories are cleaned up after success or failure.

Gemini cost accounting uses global standard rates:

| Model | Input / 1M tokens | Output / 1M tokens |
|---|---:|---:|
| `gemini-3.5-flash-lite` | $0.30 | $2.50 |
| `gemini-3.6-flash` | $1.50 | $7.50 |

`toolUsePromptTokenCount` is input; `thoughtsTokenCount` is output. Cached-token
fields remain separate in telemetry.

## Code map

| Area | Main modules |
|---|---|
| Transaction orchestration | `application/edition_pipeline.py`, `scripts/ocr/process-edition.sh` |
| IIIF inventory/download | `ingestion/manifest.py`, `ingestion/download.py`, `scripts/iiif/download.py` |
| Source preparation | `preprocessing/image_converter.py`, `image_preprocessor.py`, `skew.py` |
| OCR and page structuring | `recognition/docai_provider.py`, `recognition/page_extractor.py` |
| Visual detection | `detection/visual_provider.py`, `american_stories_provider.py`, `hybrid_provider.py`, `yolo_provider.py` |
| Visual assignment | `image_linking/visual_matcher.py`, `assignment_applier.py`, `cropper.py` |
| Grouping and seams | `merging/llm_merge.py`, `merging/merge_sanitizer.py` |
| Enrichment and review | `application/ad_enrichment.py`, `application/content_rescue.py` |
| Validation and provenance | `export/validation.py`, `export/provenance.py`, `export/edition_writer.py` |
| Retry, telemetry, cost | `shared/retry.py`, `diagnostics/failure_log.py`, `diagnostics/costing.py` |

The package dependency direction is enforced by AST tests: application code may
orchestrate domain modules, while contracts, shared primitives, and config stay
below domain layers.

## Verification

The OCR tests live under `tests/ocr/`:

```bash
python3 -m pytest -q tests/ocr
```

They cover exact model/thinking/media routing, shared retry ceilings, token cost
classification, manifest state accounting, pixel preservation, deskew policy,
Document AI behavior, hybrid detector routing, complete visual disposition,
group partition validation, all-boundary seam batching, repair-anchor safety,
lossless fallbacks, asset constraints, shell promotion invariants, and the
no-debug-artifact rule.

Live ADC smoke tests and frozen-gold scoring are separate because they incur
cloud cost. The February 21, 1990 twelve-page gold candidate is the primary
calibration reference; detector evaluation must use the same hybrid mode as the
hosted path.
