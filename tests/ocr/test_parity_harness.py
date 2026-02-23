"""Parity harness tests for OCR run artifact structure."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.evaluation.parity import collect_artifact_keysets, compare_keysets


BASELINE_RUN = ROOT / "ocr" / "runs" / "1970-05-28" / "runs" / "full-run-2"
CANDIDATE_RUN = ROOT / "ocr" / "runs" / "1970-05-28" / "runs" / "improved-merge-1"
FIXTURE = ROOT / "tests" / "ocr" / "fixtures" / "parity" / "1970-05-28-full-run-2.keysets.json"

_runs_present = BASELINE_RUN.exists() and CANDIDATE_RUN.exists()
pytestmark = pytest.mark.skipif(
    not _runs_present,
    reason="OCR pipeline runs not present in ocr/runs/ — run the pipeline first",
)


def test_parity_fixture_file_exists():
    assert FIXTURE.exists(), f"Missing parity fixture: {FIXTURE}"


def test_collect_artifact_keysets_matches_fixture_shape():
    observed = collect_artifact_keysets(BASELINE_RUN)
    expected = json.loads(FIXTURE.read_text())
    assert compare_keysets(expected, observed) == {}


def test_candidate_run_keyset_parity_against_baseline():
    baseline = collect_artifact_keysets(BASELINE_RUN)
    candidate = collect_artifact_keysets(CANDIDATE_RUN)
    diff = compare_keysets(baseline, candidate)
    assert diff == {}
