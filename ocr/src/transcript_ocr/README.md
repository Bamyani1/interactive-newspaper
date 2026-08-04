# transcript_ocr Package

This package contains all OCR pipeline logic, organized by domain.

## Package structure

```
config/         — Model, client, environment, and path configuration
contracts/      — Data models (content, diagnostics, ads)
cli/            — Candidate build, validation, failure-log, and gold-score entry points
application/    — Pipeline orchestration (edition_pipeline, page_pipeline, ad_enrichment)
ingestion/      — File discovery, path resolution
preprocessing/  — Image normalization, skew correction
detection/      — American Stories plus DocLayout table detection
recognition/    — DocAI & Gemini text extraction, prompts
postprocessing/ — Text deduplication, byline cleanup, and page normalization
merging/        — Model-decided grouping and batched seam review
image_linking/  — Model-decided visual disposition (no spatial fallback)
export/         — Candidate validation, atomic JSON, and provenance
evaluation/     — Gold-edition accuracy scoring (gold_score)
diagnostics/    — In-memory metrics and the metadata-only failure log
shared/         — Console utilities, retry helpers
```

## Call chain

```
ocr/convert_scans.py  (thin wrapper, adds src/ to sys.path)
  → cli/convert_scans.py::main()  (single arg parse, canonical paths)
    → application/edition_pipeline.py::process_edition()  (validated candidate)
      → scripts/ocr/process-edition.sh  (upload + atomic promotion)
```

## Rules

- Keep the public edition schema stable.
- Do not add raw responses, prompts, OCR text, snapshots, or per-run artifacts.
- New modules should be added under the matching domain directory.
- Avoid cross-layer imports that violate architecture tests in `tests/ocr/architecture/`.
- All path constants are defined in `config/paths.py` — do not compute OCR_ROOT locally.
