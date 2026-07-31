"""Production OCR must not expose the removed debug-artifact path."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / "ocr" / "src" / "transcript_ocr"


def test_debug_artifact_writers_are_removed() -> None:
    removed = [
        PACKAGE / "diagnostics" / "run_manifest.py",
        PACKAGE / "diagnostics" / "snapshots.py",
        PACKAGE / "diagnostics" / "issue_report.py",
        PACKAGE / "export" / "artifact_writer.py",
        PACKAGE / "evaluation" / "run_compare.py",
    ]
    assert not any(path.exists() for path in removed)


def test_production_orchestrators_name_no_debug_artifacts() -> None:
    sources = [
        PACKAGE / "application" / "edition_pipeline.py",
        PACKAGE / "application" / "page_pipeline.py",
        PACKAGE / "recognition" / "page_extractor.py",
        PACKAGE / "merging" / "llm_merge.py",
        ROOT / "scripts" / "ocr" / "process-edition.sh",
    ]
    forbidden = (
        "snapshots_dir",
        "run_manifest.json",
        "issue_report.json",
        "diagnostics.json",
        "raw_gemini",
    )
    combined = "\n".join(path.read_text(encoding="utf-8") for path in sources)
    assert all(value not in combined for value in forbidden)
