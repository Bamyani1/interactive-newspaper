"""Behavior tests for key OCR fallback and failure paths."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.application.edition_pipeline import (  # noqa: E402
    EditionPipelineError,
    process_edition,
)
from transcript_ocr.application.page_pipeline import structure_and_link_page  # noqa: E402
from transcript_ocr.contracts.content_models import Article, PageContent  # noqa: E402
from transcript_ocr.contracts.diagnostics_models import PageDiagnostics  # noqa: E402
from transcript_ocr.image_linking.visual_matcher import _unresolved_assignments  # noqa: E402
from transcript_ocr.ingestion.pathing import RunPaths  # noqa: E402


def test_visual_match_failure_preserves_unresolved_region_without_spatial_fallback(tmp_path, monkeypatch):
    img_path = tmp_path / "Page 02.jpg"
    Image.new("L", (300, 300), color=255).save(img_path)

    page_content = PageContent(
        articles=[Article(headline="H", body="B", images=[], image_files=[])],
        ads=[],
        other_content=[],
        page_number="2",
        publication_info="",
    )
    preprocessed = Image.new("L", (300, 300), color=255)
    regions = [(10, 10, 210, 210)]

    monkeypatch.setattr(
        "transcript_ocr.application.page_pipeline.process_page_with_docai",
        lambda *a, **k: (page_content, preprocessed, regions),
    )
    monkeypatch.setattr(
        "transcript_ocr.application.page_pipeline.crop_and_save_images",
        lambda *a, **k: {0: "images/Page 02_img1.jpg"},
    )
    monkeypatch.setattr(
        "transcript_ocr.application.page_pipeline.match_images_visual",
        lambda *a, **k: _unresolved_assignments(1),
    )

    diag = PageDiagnostics()
    out_dir = tmp_path / "public"
    out_dir.mkdir(parents=True, exist_ok=True)
    (tmp_path / "ocr").mkdir(parents=True, exist_ok=True)

    # Provide a fake docai_result (not used since process_page_with_docai is mocked)
    class _FakeDocAI:
        raw_text = "test"
        mean_confidence = 0.95
        low_confidence_words = []
        paragraphs = []

    result = structure_and_link_page(
        object(),
        str(img_path),
        _FakeDocAI(),
        preprocessed,
        regions,
        str(out_dir),
        diag=diag,
    )

    assert result is not None
    assert not (OCR_SRC / "transcript_ocr" / "image_linking" / "spatial_matcher.py").exists()
    assert result.articles[0].image_files == []
    assert result.other_content[-1].body == "images/Page 02_img1.jpg"


def test_docai_failure_below_threshold_aborts_without_debug_artifacts(tmp_path, monkeypatch):
    """A failed edition is cleaned up and retained only in the metadata log."""
    edition_dir = tmp_path / "ocr" / "scans" / "1970-01-01"
    edition_dir.mkdir(parents=True, exist_ok=True)
    from PIL import Image
    Image.new("L", (100, 100), color=128).save(str(edition_dir / "Page 01.png"), format="PNG")

    public_root = tmp_path / "public" / "editions"
    public_root.mkdir(parents=True, exist_ok=True)

    from transcript_ocr.recognition.docai_provider import DocAIError

    def _fail_extract_docai(_img, diag=None, work_dir=None):
        raise DocAIError("synthetic failure")

    monkeypatch.setattr("transcript_ocr.application.edition_pipeline.extract_page_docai", _fail_extract_docai)
    monkeypatch.setattr("transcript_ocr.application.edition_pipeline._log_failure", lambda *a, **k: None)

    paths = RunPaths(
        edition_dir=str(edition_dir),
        public_output_root=str(public_root),
        work_root=str(tmp_path / "work"),
    )
    with pytest.raises(EditionPipelineError, match="70% required"):
        process_edition(settings=None, client=object(), paths=paths)

    assert not (public_root / "1970-01-01").exists()


def test_existing_candidate_directory_is_never_reused(tmp_path):
    """Even an incomplete prior candidate must not be overwritten in place."""
    edition_dir = tmp_path / "ocr" / "scans" / "1970-01-01"
    edition_dir.mkdir(parents=True)
    public_root = tmp_path / "candidate-root"
    existing = public_root / "1970-01-01"
    existing.mkdir(parents=True)
    sentinel = existing / "partial.txt"
    sentinel.write_text("keep", encoding="utf-8")

    paths = RunPaths(
        edition_dir=str(edition_dir),
        public_output_root=str(public_root),
        work_root=str(tmp_path / "work"),
    )
    with pytest.raises(EditionPipelineError, match="candidate already exists"):
        process_edition(settings=None, client=object(), paths=paths)

    assert sentinel.read_text(encoding="utf-8") == "keep"
