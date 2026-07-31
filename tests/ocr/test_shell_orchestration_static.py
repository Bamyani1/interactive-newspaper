"""Static invariants for transactional OCR shell orchestration."""

from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROCESS = ROOT / "scripts/ocr/process-edition.sh"
BATCH = ROOT / "scripts/ocr/process-unprocessed.sh"
AUDIT = ROOT / "scripts/ocr/run-audit-editions.sh"
GOLD = ROOT / "scripts/ocr/run-gold-regression.sh"


def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_shell_scripts_parse():
    for script in (PROCESS, BATCH, AUDIT, GOLD):
        subprocess.run(["bash", "-n", str(script)], check=True)


def test_gold_regression_cannot_publish_or_seed():
    source = _text(GOLD)
    assert "ocr/convert_scans.py" in source
    assert "gold-candidates/1990-02-21/source/manifest.json" in source
    for forbidden in (
        "process-edition.sh",
        "upload-images.mjs",
        "db:seed",
        "public/editions",
    ):
        assert forbidden not in source


def test_process_script_has_no_legacy_resume_or_debug_artifacts():
    source = _text(PROCESS)
    for forbidden in (
        "--from-stage",
        "--run-id",
        "--keep-source",
        "cleanup-images.mjs",
        "ocr/runs",
        "pipeline-summary.json",
        "GOOGLE_API_KEY",
        "GEMINI_API_KEY",
        "tee ",
    ):
        assert forbidden not in source


def test_process_script_is_adc_only_and_database_is_seed_gated():
    source = _text(PROCESS)
    assert "export GOOGLE_GENAI_USE_VERTEXAI=true" in source
    assert "export GOOGLE_CLOUD_LOCATION=global" in source
    assert "export OCR_ENVIRONMENT=production" in source
    assert "GOOGLE_CLOUD_PROJECT is required for Vertex AI ADC" in source
    assert "OCR_DETECTOR_LICENSES_ACCEPTED=true is required for hosted OCR" in source
    seed_guard = 'if [[ "$SEED_AFTER_PUBLISH" == "true" || "$MODE" == "repair-seed" ]]'
    assert seed_guard in source
    assert source.index(seed_guard) < source.index("DATABASE_URL is required only for database seeding")


def test_normal_publication_uses_candidate_validation_and_atomic_swap():
    source = _text(PROCESS)
    assert 'STAGING_PARENT="$PUBLIC_ROOT/.staging"' in source
    assert 'ROLLBACK_PARENT="$PUBLIC_ROOT/.rollback"' in source
    assert 'LOCK_PARENT="$PUBLIC_ROOT/.locks"' in source
    assert '--output-root "$CANDIDATE_ROOT"' in source
    assert '--work-root "$WORK_ROOT"' in source
    assert 'run_upload "$CANDIDATE_ROOT"' in source
    assert source.count('validate_edition_dir "$CANDIDATE_EDITION"') >= 3
    assert 'mv -- "$final_edition" "$saved_edition"' in source
    assert 'mv -- "$CANDIDATE_EDITION" "$final_edition"' in source
    assert 'safe_remove_tree "$ROLLBACK_CONTAINER" "$ROLLBACK_PARENT"' in source


def test_repairs_require_structurally_valid_public_edition():
    source = _text(PROCESS)
    assert '--repair-upload YYYY-MM-DD' in source
    assert '--repair-seed YYYY-MM-DD' in source
    validation = 'validate_edition_dir "$PUBLIC_ROOT/$DATE"'
    assert source.count(validation) == 2


def test_input_cleanup_is_guarded_to_the_canonical_inbox():
    source = _text(PROCESS)
    assert 'is_path_below "$SOURCE_ABS" "$INBOX_ROOT"' in source
    assert 'safe_remove_tree "$SOURCE_ABS" "$INBOX_ROOT"' in source
    assert 'rm -rf -- "$EDITION_PATH"' not in source


def test_batch_and_audit_keep_only_stdout_summaries():
    combined = _text(BATCH) + _text(AUDIT)
    for forbidden in (
        "--from-stage",
        "ocr/runs",
        "pipeline.log",
        "pipeline-summary.json",
        "batch report",
    ):
        assert forbidden not in combined.casefold()
    assert "--seed" in _text(BATCH)
