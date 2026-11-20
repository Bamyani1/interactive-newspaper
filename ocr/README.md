# Historical Newspaper OCR

This package turns a manifest-backed newspaper edition into a validated public
`edition.json` plus referenced image assets. The production wrapper treats an
edition as a transaction: OCR builds an isolated candidate, assets are optimized
and uploaded, the candidate is validated again, and only then is it atomically
promoted into `public/editions/<YYYY-MM-DD>/`.

The public edition and database schemas are unchanged. The OCR pipeline does not
run or modify the RAG pipeline.

The detailed runtime design is in
[`docs/architecture/ocr-pipeline.md`](../docs/architecture/ocr-pipeline.md).

## Production invariants

- IIIF manifest canvases are the page-count denominator.
- Every canvas ends as `passed_content`, `passed_visual`, `confirmed_blank`, or
  `failed`.
- Publication requires at least 70% passing canvases. A failed cloud call is never
  reclassified as a blank page, and a page whose structured text still leaves
  out most of an OCR story block after one retry fails (blocks inside detected
  ads, tables and photos are not checked).
- Claude reads the page text, strip by strip, then structures that text and may
  use images for layout or visual association, but it may not invent historical
  wording.
- Visual detection and crops use a native-resolution color source master;
  page reading and structuring use a separate lossless grayscale derivative.
- Every model call goes to the Anthropic API with `ANTHROPIC_API_KEY`. The
  pipeline makes no Google call and has no cross-model fallback.
- Production does not retain prompts, OCR transcripts, raw responses,
  snapshots, issue reports, or per-run directories.

## Models and calls

| Call | Model | Effort | Images |
|---|---|---|---|
| Page reading | `claude-haiku-5-5` | `xhigh` | page strips |
| Page structuring | `claude-haiku-5-5` | `xhigh` | page |
| Visual assignment | `claude-haiku-5-5` | `high` | full page and crops |
| Article grouping | `claude-sonnet-5-5` | `high` | none |
| Seam review | `claude-sonnet-5-5` | `high` | none |
| Ad enrichment | `claude-haiku-5-5` | `high` | none |
| Final content review | `claude-haiku-5-5` | `high` | none |

Routes live in `config/model_calls.py`. Every call streams with adaptive
thinking and a JSON-schema output format; images go as lossless PNG, resized to
Claude's vision limits. Sampling controls are intentionally absent. A logical
stage has at most three total attempts (rate limits and overload up to eight);
transient and schema-correction retries share that budget and keep the same
model and configuration.

## Setup

Create the Python environment:

```bash
cd ocr
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
```

The OCR pipeline locks the Anthropic Python SDK in `requirements.txt`. Add the
API key to the repository-root `.env.local`:

```dotenv
ANTHROPIC_API_KEY=...
```

Normal publication also needs the R2 variables used by
`scripts/db/upload-images.mjs` whenever the edition contains referenced images:

```dotenv
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
```

`DATABASE_URL` is needed only when `--seed` or `--repair-seed` is requested.

## Download an edition

Use the existing IIIF downloader. It saves the source manifest and numbers every
download with its four-digit canvas index:

```bash
python scripts/iiif/download.py 'https://example.org/iiif/manifest.json'
```

Downloads are staged through `.part` files and decoded before rename. Missing
canvases stay in the manifest inventory and count as failed pages; the local
files do not redefine the denominator.

## Process and publish

Process one edition:

```bash
scripts/ocr/process-edition.sh \
  'ocr/inbox/1990-02-21 The Transcript' \
  --workers 3
```

Add `--seed` only when the validated public edition should also be written to
the database:

```bash
scripts/ocr/process-edition.sh 'ocr/inbox/1990-02-21 The Transcript' --workers 3 --seed
```

The default page-worker count is 1 when neither `--workers` nor `OCR_WORKERS` is
set. Page extraction and page structuring are parallelized; edition grouping,
seam review, enrichment, validation, upload, and promotion are edition-level.

Process every edition directory in the inbox:

```bash
scripts/ocr/process-unprocessed.sh --parallel 2 --workers 3
```

Use `--dry-run` to list the batch without processing it. Add `--seed` to opt in
to seeding each successfully published edition.

Only post-publication repairs are supported:

```bash
scripts/ocr/process-edition.sh --repair-upload 1990-02-21
scripts/ocr/process-edition.sh --repair-seed 1990-02-21
```

Both repair modes require an already published edition that passes structural
validation. OCR stage resumption and run IDs are intentionally unsupported.

## Runtime flow

1. Build an authoritative page inventory from `source-manifest.json`,
   `manifest.json`, or an explicit `--manifest` path.
2. Convert every TIFF frame to a verified, pixel-identical PNG source master.
   Delete a TIFF only after every frame passes decoded-pixel verification.
3. Create two run-scoped branches per page: a native color source master and an
   8-bit grayscale OCR derivative. The only optional geometric change is fixed
   deskew over -2.0 to +2.0 degrees in 0.1-degree steps, applied from 0.2 degrees.
4. Claude reads the grayscale derivative in full-width strips, each with tinted
   context above and below, and returns positioned text blocks. No CLAHE,
   morphology, sharpening, binarization, or border crop is applied.
5. Run the default hybrid visual detector on the color source master: American
   Stories supplies newspaper visuals and DocLayout supplies non-overlapping
   tables.
6. Structure each page with Claude Haiku, then assign every proposed
   visual using the annotated page and 10%-padded crops. Batches contain at most
   40 regions. Invalid or failed assignments remain unresolved standalone
   evidence; there is no spatial semantic fallback.
7. Group all available article fragments with one Claude Sonnet call. Review
   all accepted adjacent seams in one additional Claude Sonnet call. Unsafe
   decisions fall back to the original fragments without losing text.
8. Enrich ads in batches of at most 50, then run the narrow deterministic final
   type/category review. Either stage abstains safely on failure.
9. Validate the candidate, optimize only referenced assets, upload them to R2,
   validate again, and atomically replace the public edition under an
   edition-specific lock.

The American Stories and DocLayout model files are downloaded lazily and cached
under `ocr/models/`. Hosted execution is gated until both detector licenses are
explicitly accepted:

```dotenv
OCR_DETECTOR_LICENSES_ACCEPTED=true
```

The wrapper exports `OCR_ENVIRONMENT=production` itself.

The detector is fixed to American Stories with the DocLayout table fallback;
there is no runtime mode override.

## Outputs and cleanup

A successful public edition contains only current serving artifacts:

```text
public/editions/YYYY-MM-DD/
  edition.json
  provenance.json
  asset-manifest.json
  images/<sha256>.webp
```

Referenced images are never enlarged. They are encoded as WebP with a maximum
2,000-pixel long edge and a target below 500 KiB. The uploader tries quality 85,
80, and 75, then reduces dimensions by 10% down to a 1,400-pixel floor (or the
smaller source size). An edition warns above 15 MiB and fails above 25 MiB.
Final byte hashes become both local filenames and R2 object keys.

The only durable failure artifact is:

```text
ocr/logs/failures.jsonl
```

It contains sanitized metadata—not prompts, OCR text, images, or model
responses. Candidate directories, source/OCR derivatives, crop intermediates,
and rollback directories are removed after success or failure. A source
directory under the canonical `ocr/inbox/` is removed by the wrapper only once
the edition is published; a run that fails earlier keeps it for a retry. An
externally supplied source directory is always preserved.

R2 garbage collection is global and registry-driven. It requires a registry
artifact from `assets:bootstrap`, unions it with live database references, is
dry-run by default, and refuses a grace period below 30 days. First-unreferenced
timestamps live in the private `ocr-assets-gc/unreferenced.json` state object,
so an object's age is never mistaken for the length of time it has been
unreferenced. `--apply` also needs `--approval-token` matching
`GC_APPROVAL_TOKEN`:

```bash
npm run assets:bootstrap -- --build --yes   # artifact under evaluation/assets/ by default
node --import tsx scripts/db/gc-r2-assets.mjs --registry <artifact.json>
node --import tsx scripts/db/gc-r2-assets.mjs --registry <artifact.json> \
  --apply --grace-days 30 --approval-token "$GC_APPROVAL_TOKEN"
```

## Frozen-gold regression

Run the 12-page extraction without upload, database seed, or public promotion:

```bash
scripts/ocr/run-gold-regression.sh
python ocr/score_gold.py \
  --gold-edition gold-candidates/1990-02-21/gold-edition.json \
  --candidate-edition /private/tmp/ocr-gold-regression-final/candidates/1990-02-21/edition.json
```

The scorer never performs fuzzy pairing implicitly. Provide `--mapping-json`
only after its gold/candidate index pairs have been manually checked against
the scans, or pass `--auto-map` to pair items by text similarity (the report
says so and lists unmatched items).

For any edition with `gold/<date>/gold-edition.json` and its scans in
`ocr/inbox/`, one command runs extraction, validates, and scores:

```bash
scripts/ocr/eval-edition.sh 1989-11-29      # writes ocr/runs/eval/<date>/<time>-<commit>-claude/
```

The run keeps each page's strips and Claude's transcription under `work/`.
`score.md` has word error rates,
paragraph-break precision/recall, the worst items and an edition-wide count of
gold words missing from every item (text filed under a different item is not
missing); `diff.md` lists every word difference.

> Note: the `gold/` and `gold-candidates/` reference editions are gitignored and
> not shipped in the public repo, so these commands run only where that curated
> data is present locally.

## Tests

Run the OCR suite from the repository root (pytest is not in
`requirements.txt`):

```bash
source ocr/.venv/bin/activate
python -m pip install pytest
python -m pytest -q tests/ocr
```

CI runs only `tests/ocr/architecture/`; the rest of the suite runs locally.

The suite covers model routing, request settings, retries, cost accounting,
manifest state accounting, source fidelity, visual dispositions, merge/seam
fallbacks, asset limits, publication behavior, and the no-debug-artifact rule.

## Troubleshooting

- **Anthropic error:** confirm `ANTHROPIC_API_KEY` in `.env.local`. Rate limits
  and overload (429, 529) are retried with longer waits; `OCR_CALL_SPACING_S`
  (default 0.5) sets the minimum gap between call starts.
- **Detector startup error:** install `ocr/requirements.txt`, confirm
  `ocr/models/` is writable, and satisfy the hosted license gate.
- **Below 70%:** inspect the terminal summary and sanitized entries in
  `ocr/logs/failures.jsonl`. The pipeline deliberately does not save raw debug
  artifacts.
- **Upload failure:** fix R2 configuration, then use `--repair-upload` against
  the still-valid public edition when appropriate.
