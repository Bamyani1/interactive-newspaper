"""Snapshot utilities."""

from __future__ import annotations

import json
import os


def _save_snapshot(snapshots_dir: str | None, name: str, data) -> None:
    """Save a pipeline stage snapshot as JSON if snapshots_dir is set."""
    if not snapshots_dir:
        return
    os.makedirs(snapshots_dir, exist_ok=True)
    path = os.path.join(snapshots_dir, name)
    with open(path, "w", encoding="utf-8") as f:
        if hasattr(data, "model_dump"):
            json.dump(data.model_dump(), f, indent=2, default=str)
        elif isinstance(data, list):
            json.dump([
                d.model_dump() if hasattr(d, "model_dump") else d for d in data
            ], f, indent=2, default=str)
        else:
            json.dump(data, f, indent=2, default=str)


save_snapshot = _save_snapshot

__all__ = ["_save_snapshot", "save_snapshot"]
