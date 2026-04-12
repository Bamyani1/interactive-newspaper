"""Behavior tests for key OCR fallback and failure paths."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.application.edition_pipeline import process_edition
from transcript_ocr.application.page_pipeline import structure_and_link_page
from transcript_ocr.contracts.content_models import Article, PageContent
from transcript_ocr.contracts.diagnostics_models import PageDiagnostics
from transcript_ocr.ingestion.pathing import RunPaths


def test_visual_match_failure_falls_back_to_spatial(tmp_path, monkeypatch):
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
    monkeypatch.setattr("transcript_ocr.application.page_pipeline.match_images_visual", lambda *a, **k: None)
    monkeypatch.setattr(
        "transcript_ocr.application.page_pipeline.match_images_to_articles",
        lambda *a, **k: ({0: 0}, []),
    )
    monkeypatch.setattr("transcript_ocr.application.page_pipeline.page_content_to_markdown", lambda *a, **k: "# ok\n")

    diag = PageDiagnostics()
    out_dir = tmp_path / "public"
    out_dir.mkdir(parents=True, exist_ok=True)
    (tmp_path / "ocr").mkdir(parents=True, exist_ok=True)

    # Provide a fake docai_result (not used since process_page_with_docai is mocked)
    class _FakeDocAI:
        raw_text = "test"
        mean_confidence = 0.95
        continuation_markers = []
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
        ocr_output_dir=str(tmp_path / "ocr"),
    )

    assert result is not None
    assert diag.visual_matching.fallback_to_spatial is True
    assert result.articles[0].image_files == ["images/Page 02_img1.jpg"]


def test_docai_failure_aborts_and_writes_diagnostics(tmp_path, monkeypatch):
    """When DocAI fails on any page, the edition aborts and writes diagnostics."""
    edition_dir = tmp_path / "ocr" / "scans" / "1970-01-01"
    edition_dir.mkdir(parents=True, exist_ok=True)
    from PIL import Image
    Image.new("L", (100, 100), color=128).save(str(edition_dir / "Page 01.png"), format="PNG")

    public_root = tmp_path / "public" / "editions"
    ocr_root = tmp_path / "ocr" / "output"
    public_root.mkdir(parents=True, exist_ok=True)
    ocr_root.mkdir(parents=True, exist_ok=True)

    from transcript_ocr.recognition.docai_provider import DocAIError

    def _fail_extract_docai(_img, diag=None, snapshots_dir=None):
        raise DocAIError("synthetic failure")

    monkeypatch.setattr("transcript_ocr.application.edition_pipeline.extract_page_docai", _fail_extract_docai)

    paths = RunPaths(
        edition_dir=str(edition_dir),
        public_output_root=str(public_root),
        ocr_output_root=str(ocr_root),
    )
    process_edition(settings=None, client=object(), paths=paths, run_id="")

    run_dir = ocr_root / "1970-01-01"
    diag_path = run_dir / "diagnostics.json"
    issue_path = run_dir / "issue_report.json"

    assert diag_path.exists()
    assert issue_path.exists()
