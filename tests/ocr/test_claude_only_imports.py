"""The OCR entry points import with every Google package blocked.

Runs with the OCR runtime installed; the architecture job installs only
pytest, so its static check (no `google` import anywhere) covers CI.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

OCR_SRC = Path(__file__).resolve().parents[2] / "ocr" / "src"


def test_the_ocr_cli_imports_with_google_packages_blocked():
    code = (
        "import sys; sys.modules['google'] = None; "
        f"sys.path.insert(0, {str(OCR_SRC)!r}); "
        "import transcript_ocr.cli.convert_scans, transcript_ocr.application.edition_pipeline"
    )
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
