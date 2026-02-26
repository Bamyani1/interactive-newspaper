"""Compatibility entrypoint smoke tests for refactor wrappers."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def test_convert_scans_wrapper_help():
    proc = _run(sys.executable, "ocr/convert_scans.py", "--help")
    assert proc.returncode == 0
    assert "Process newspaper scans into structured OCR output." in proc.stdout


def test_enrich_ads_wrapper_help():
    proc = _run(sys.executable, "ocr/enrich_ads.py", "--help")
    assert proc.returncode == 0
    assert "Enrich ads in edition.json files" in proc.stdout


