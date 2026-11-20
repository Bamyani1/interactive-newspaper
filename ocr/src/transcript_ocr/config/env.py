"""Load the repository's .env.local for OCR entry points."""

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv


def load_repo_env() -> None:
    repo_root = Path(__file__).resolve().parents[4]
    dotenv_path = repo_root / ".env.local"
    if dotenv_path.exists():
        load_dotenv(dotenv_path=dotenv_path)


__all__ = ["load_repo_env"]
