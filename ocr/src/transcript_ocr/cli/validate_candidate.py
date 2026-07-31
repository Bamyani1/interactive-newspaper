from __future__ import annotations

import argparse

from ..export.validation import CandidateValidationError, validate_candidate_file


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate an OCR edition candidate.")
    parser.add_argument("edition_json")
    parser.add_argument("--date", default="")
    args = parser.parse_args(argv)
    try:
        validate_candidate_file(args.edition_json, expected_date=args.date or None)
    except CandidateValidationError as exc:
        print(f"INVALID: {exc}")
        return 1
    print("VALID")
    return 0


__all__ = ["main"]
