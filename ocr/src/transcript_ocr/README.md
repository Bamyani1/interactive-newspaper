# transcript_ocr Package

This package is the new modular home for OCR pipeline code.

## Current migration status

- Stage directories, config, contracts, CLI, and architecture tests are in place.
- Stage modules now own extracted OCR logic (preprocessing, detection,
  recognition, postprocessing, image-linking, merging, diagnostics, export).
- `transcript_ocr.engine.*` is now a compatibility shim layer for legacy
  imports while runtime orchestration lives in `application/*`.
- `compare_runs` and `score_gold` logic has been moved into:
  - `transcript_ocr.evaluation.run_compare`
  - `transcript_ocr.evaluation.gold_score`
- `convert_scans` and `enrich_ads` now execute package-native runtimes by default:
  - `transcript_ocr.application.convert_scans_runtime`
  - `transcript_ocr.application.ad_enrichment`
- Top-level entrypoints remain stable via wrappers:
  - `ocr/convert_scans.py`
  - `ocr/enrich_ads.py`
  - `ocr/compare_runs.py`
  - `ocr/score_gold.py`
- Temporary fallback remains available for one stabilization cycle:
  - `OCR_FORCE_LEGACY=1` routes `convert_scans`/`enrich_ads` to `*_legacy.py`.
- New parity harness utilities live in `transcript_ocr.evaluation.parity` with
  fixture-backed tests under `tests/ocr/fixtures/parity`.

## Rules

- Keep external CLI behavior and output contracts stable while refactoring internals.
- New modules should be added under the matching domain directory (`recognition`, `postprocessing`, `merging`, etc.).
- Avoid cross-layer imports that violate architecture tests in `tests/ocr/architecture/`.
