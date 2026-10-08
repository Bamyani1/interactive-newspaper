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

_KEPT = (
    "The campus center will open within two years, said the president of the "
    "board on Tuesday after a long vote in the main hall."
)


class _OneBlockDocAI:
    raw_text = _KEPT
    mean_confidence = 0.95
    low_confidence_words: list[str] = []
    paragraphs = [_KEPT]

    def __init__(self, label=""):
        self.paragraph_regions = [type("Block", (), {"text": _KEPT, "label": label})()]


def _structure_with_bodies(tmp_path, monkeypatch, bodies, label=""):
    img_path = tmp_path / "Page 03.jpg"
    Image.new("L", (300, 300), color=255).save(img_path)
    preprocessed = Image.new("L", (300, 300), color=255)
    calls = []

    def structure(*_args, **kwargs):
        body = bodies[len(calls)]
        calls.append(kwargs.get("seed", 0))
        page = PageContent(articles=[Article(headline="Center", body=body)])
        return page, preprocessed, []

    monkeypatch.setattr("transcript_ocr.application.page_pipeline.process_page_with_docai", structure)
    diag = PageDiagnostics()
    result = structure_and_link_page(
        object(), str(img_path), _OneBlockDocAI(label), preprocessed, [], str(tmp_path), diag=diag
    )
    return result, calls, diag


def test_page_missing_ocr_text_is_structured_again(tmp_path, monkeypatch):
    result, calls, _ = _structure_with_bodies(tmp_path, monkeypatch, ["Too short.", _KEPT])

    # Generation is seeded, so the retry must ask for a different sample.
    assert calls == [0, 1]
    assert result is not None
    assert result.articles[0].body == _KEPT


def test_page_still_missing_ocr_text_after_one_retry_fails(tmp_path, monkeypatch):
    result, calls, diag = _structure_with_bodies(tmp_path, monkeypatch, ["Too short.", "Still short."])

    assert len(calls) == 2
    assert result is None
    assert "OCR block" in diag.error


def test_ad_text_restructured_by_the_model_is_not_a_missing_block(tmp_path, monkeypatch):
    # Ad tables are rewritten row by row; only story text is held to the check.
    result, calls, _ = _structure_with_bodies(
        tmp_path, monkeypatch, ["Too short."], label="ad or cartoon"
    )

    assert calls == [0]
    assert result is not None


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
    with pytest.raises(EditionPipelineError, match="every manifest canvas must pass"):
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
