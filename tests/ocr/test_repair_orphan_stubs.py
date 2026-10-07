"""The orphan-stub repair script must import and merge without the pipeline's
deleted continuation module (removed in 88d7b27)."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "repair-orphan-stubs.py"

# Runs in a subprocess: importing the script loads .env.local, which must not
# leak into this test session's environment.
PROBE = """
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("repair_orphan_stubs", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
articles = [
    {"headline": "Council votes", "body": "The council voted to (Continued on page 5)",
     "source_pages": [1], "continues_on": "5"},
    {"headline": "More council", "body": "approve the levy. (Continued from page 1)",
     "source_pages": [5], "continued_from": "1"},
]
print(json.dumps(module.apply_merge(articles, 0, 1, "Council votes")))
"""


def test_apply_merge_strips_markers_and_joins_bodies():
    result = subprocess.run(
        [sys.executable, "-c", PROBE, str(SCRIPT)],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    merged = json.loads(result.stdout.strip().splitlines()[-1])
    assert merged["body"] == "The council voted to\n\napprove the levy."
    assert merged["source_pages"] == [1, 5]
    assert merged["continues_on"] == ""
