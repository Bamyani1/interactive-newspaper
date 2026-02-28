# transcript_ocr Package

This package contains all OCR pipeline logic, organized by domain.

## Package structure

```
config/         — Settings, environment, path constants
contracts/      — Data models (content, diagnostics, ads)
cli/            — CLI entry points (convert_scans, enrich_ads, compare_runs)
application/    — Pipeline orchestration (edition_pipeline, page_pipeline, ad_enrichment)
ingestion/      — File discovery, path resolution
preprocessing/  — Image normalization, skew correction
detection/      — YOLO region detection
recognition/    — DocAI & Gemini text extraction, prompts
postprocessing/ — Text deduplication, byline cleanup, ad reclassification
merging/        — Cross-page article merging (deterministic + LLM)
image_linking/  — Visual/spatial image-to-article matching
export/         — JSON/markdown writers
diagnostics/    — Reporting, snapshots, run manifests
evaluation/     — Run comparison & gold scoring
shared/         — Console utilities, retry helpers
```

## Call chain

```
ocr/convert_scans.py  (thin wrapper, adds src/ to sys.path)
  → cli/convert_scans.py::main()  (single arg parse, canonical paths)
    → application/edition_pipeline.py::process_edition()  (5-phase core)
```

## Rules

- Keep external CLI behavior and output contracts stable while refactoring internals.
- New modules should be added under the matching domain directory.
- Avoid cross-layer imports that violate architecture tests in `tests/ocr/architecture/`.
- All path constants are defined in `config/paths.py` — do not compute OCR_ROOT locally.
