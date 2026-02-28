"""Tests for package-runtime default behavior."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _run(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    return subprocess.run(
        args,
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
        env=merged_env,
    )


def test_convert_scans_defaults_to_package_runtime():
    proc = _run(sys.executable, "ocr/convert_scans.py", "--help")
    assert proc.returncode == 0
    assert "usage: convert_scans.py" in proc.stdout


def test_enrich_ads_defaults_to_package_runtime():
    proc = _run(sys.executable, "ocr/enrich_ads.py", "--help")
    assert proc.returncode == 0
    assert "usage: enrich_ads.py" in proc.stdout
