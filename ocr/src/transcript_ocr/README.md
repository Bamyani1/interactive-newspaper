# transcript_ocr Package

This package contains all OCR pipeline logic, organized by domain.

## Package structure

```
config/         — Model, client, environment, and path configuration
contracts/      — Data models (content, ads, diagnostics) and canvas page states
cli/            — Candidate build, validation, failure-log, and gold-score entry points
application/    — Orchestration (edition_pipeline, page_pipeline, ad_enrichment, content_rescue final review)
ingestion/      — IIIF manifest inventory, downloads, file discovery, path resolution
preprocessing/  — Lossless TIFF conversion, source/OCR image branches, deskew
detection/      — American Stories plus DocLayout table detection
recognition/    — Document AI OCR, Gemini page structuring, prompts
postprocessing/ — Text deduplication, byline cleanup, and page normalization
merging/        — Model-decided grouping and batched seam review
image_linking/  — Model-decided visual disposition (no spatial fallback)
export/         — Candidate validation, atomic JSON, and provenance
evaluation/     — Gold-edition accuracy scoring (gold_score)
diagnostics/    — In-memory metrics and the metadata-only failure log
shared/         — Console, retry, atomic file writes, text and timing helpers
```

## Call chain

```
scripts/ocr/process-edition.sh  (preflight, locks, validate, upload, atomic promotion, optional seed)
  → ocr/convert_scans.py  (thin wrapper, adds src/ to sys.path)
    → cli/convert_scans.py::main()  (arg parse, manifest inventory, Gemini client)
      → application/edition_pipeline.py::process_edition()  (validated candidate under --output-root)
```

## Rules

- Keep the public edition schema stable.
- Do not add raw responses, prompts, OCR text, snapshots, or per-run artifacts.
- New modules should be added under the matching domain directory.
- Avoid cross-layer imports that violate architecture tests in `tests/ocr/architecture/`.
- All path constants are defined in `config/paths.py` — do not compute OCR_ROOT locally.
