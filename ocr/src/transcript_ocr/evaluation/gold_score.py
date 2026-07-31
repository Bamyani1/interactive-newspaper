"""Final-only scoring against a frozen schema-compatible gold edition."""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path
from typing import Any

_WORD_RE = re.compile(r"\w+(?:[\u2019'\-]\w+)*", re.UNICODE)
_COLLECTIONS = ("articles", "ads", "other_content")
_IDENTITY_FIELD = {
    "articles": "headline",
    "ads": "business_name",
    "other_content": "title",
}
_STRUCTURED_FIELDS = {
    "articles": (
        "headline",
        "author",
        "writer_position",
        "category",
        "source_pages",
        "continues_on",
        "continued_from",
    ),
    "ads": ("business_name",),
    "other_content": ("title",),
}


def _normalized_words(text: str) -> list[str]:
    normalized = unicodedata.normalize("NFKC", text or "").casefold()
    return [match.group(0) for match in _WORD_RE.finditer(normalized)]


def _normalized_exact(text: str) -> str:
    return " ".join(_normalized_words(text))


def _strict_chars(text: str) -> str:
    return (text or "").replace("\r\n", "\n").replace("\r", "\n")


def _edit_counts(reference: list[str], hypothesis: list[str]) -> dict[str, int]:
    """Return one deterministic optimal word-edit path in linear memory."""
    previous = [(index, 0, index, 0) for index in range(len(hypothesis) + 1)]
    for row, ref_token in enumerate(reference, start=1):
        current = [(row, row, 0, 0)]
        for column, hyp_token in enumerate(hypothesis, start=1):
            if ref_token == hyp_token:
                current.append(previous[column - 1])
                continue
            sub = previous[column - 1]
            delete = previous[column]
            insert = current[column - 1]
            choices = (
                (sub[0] + 1, sub[1], sub[2], sub[3] + 1, 0),
                (delete[0] + 1, delete[1] + 1, delete[2], delete[3], 1),
                (insert[0] + 1, insert[1], insert[2] + 1, insert[3], 2),
            )
            best = min(choices, key=lambda item: (item[0], item[4]))
            current.append(best[:4])
        previous = current
    distance, deletions, insertions, substitutions = previous[-1]
    return {
        "distance": distance,
        "substitutions": substitutions,
        "deletions": deletions,
        "insertions": insertions,
    }


def _edit_distance(reference: str, hypothesis: str) -> int:
    """Strict character Levenshtein distance in linear memory."""
    if len(reference) < len(hypothesis):
        reference, hypothesis = hypothesis, reference
    previous = list(range(len(hypothesis) + 1))
    for row, ref_character in enumerate(reference, start=1):
        current = [row]
        for column, hyp_character in enumerate(hypothesis, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[column] + 1,
                    previous[column - 1] + (ref_character != hyp_character),
                )
            )
        previous = current
    return previous[-1]


def _exact_pairs(gold_items: list[dict], candidate_items: list[dict], collection: str):
    identity = _IDENTITY_FIELD[collection]
    gold_by_fingerprint: dict[tuple[str, str], list[int]] = {}
    candidate_by_fingerprint: dict[tuple[str, str], list[int]] = {}
    for index, item in enumerate(gold_items):
        key = (_normalized_exact(item.get(identity, "")), _normalized_exact(item.get("body", "")))
        gold_by_fingerprint.setdefault(key, []).append(index)
    for index, item in enumerate(candidate_items):
        key = (_normalized_exact(item.get(identity, "")), _normalized_exact(item.get("body", "")))
        candidate_by_fingerprint.setdefault(key, []).append(index)
    pairs = []
    for key in sorted(set(gold_by_fingerprint) & set(candidate_by_fingerprint)):
        pairs.extend(zip(gold_by_fingerprint[key], candidate_by_fingerprint[key]))
    return [(int(gold_index), int(candidate_index)) for gold_index, candidate_index in pairs]


def _manual_pairs(
    mapping: dict[str, Any],
    collection: str,
    gold_count: int,
    candidate_count: int,
) -> list[tuple[int, int]]:
    pairs: list[tuple[int, int]] = []
    for entry in mapping.get(collection, []):
        if isinstance(entry, dict):
            pair = (int(entry["gold"]), int(entry["candidate"]))
        else:
            pair = (int(entry[0]), int(entry[1]))
        pairs.append(pair)
    if len({gold for gold, _ in pairs}) != len(pairs):
        raise ValueError(f"duplicate gold index in {collection} mapping")
    if len({candidate for _, candidate in pairs}) != len(pairs):
        raise ValueError(f"duplicate candidate index in {collection} mapping")
    if any(gold < 0 or gold >= gold_count for gold, _ in pairs):
        raise ValueError(f"out-of-range gold index in {collection} mapping")
    if any(candidate < 0 or candidate >= candidate_count for _, candidate in pairs):
        raise ValueError(f"out-of-range candidate index in {collection} mapping")
    return pairs


def _rate(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 6) if denominator else 1.0


def _collection_score(
    gold_items: list[dict],
    candidate_items: list[dict],
    collection: str,
    pairs: list[tuple[int, int]],
) -> dict[str, Any]:
    matched_gold = {gold for gold, _ in pairs}
    matched_candidate = {candidate for _, candidate in pairs}
    precision = _rate(len(pairs), len(candidate_items))
    recall = _rate(len(pairs), len(gold_items))
    f1 = round(2 * precision * recall / (precision + recall), 6) if precision + recall else 0.0

    word_totals = {"reference_words": 0, "substitutions": 0, "deletions": 0, "insertions": 0}
    character_reference = 0
    character_errors = 0
    field_totals = {
        field: {"matches": 0, "compared": len(pairs)}
        for field in _STRUCTURED_FIELDS[collection]
    }
    pair_details = []
    for gold_index, candidate_index in pairs:
        gold = gold_items[gold_index]
        candidate = candidate_items[candidate_index]
        gold_words = _normalized_words(str(gold.get("body") or ""))
        candidate_words = _normalized_words(str(candidate.get("body") or ""))
        edits = _edit_counts(gold_words, candidate_words)
        word_totals["reference_words"] += len(gold_words)
        for field in ("substitutions", "deletions", "insertions"):
            word_totals[field] += edits[field]
        gold_characters = _strict_chars(str(gold.get("body") or ""))
        candidate_characters = _strict_chars(str(candidate.get("body") or ""))
        character_reference += len(gold_characters)
        character_errors += _edit_distance(gold_characters, candidate_characters)
        exact_fields = {}
        for field in _STRUCTURED_FIELDS[collection]:
            exact = gold.get(field, "") == candidate.get(field, "")
            exact_fields[field] = exact
            field_totals[field]["matches"] += int(exact)
        pair_details.append(
            {
                "gold_index": gold_index,
                "candidate_index": candidate_index,
                "gold_label": gold.get(_IDENTITY_FIELD[collection], ""),
                "candidate_label": candidate.get(_IDENTITY_FIELD[collection], ""),
                "word_edits": edits,
                "exact_fields": exact_fields,
            }
        )

    word_errors = sum(word_totals[field] for field in ("substitutions", "deletions", "insertions"))
    word_totals["wer"] = _rate(word_errors, word_totals["reference_words"])
    word_totals["missing_word_rate"] = _rate(word_totals["deletions"], word_totals["reference_words"])
    word_totals["extra_word_rate"] = _rate(word_totals["insertions"], word_totals["reference_words"])
    for totals in field_totals.values():
        totals["accuracy"] = _rate(totals["matches"], totals["compared"])

    return {
        "gold_count": len(gold_items),
        "candidate_count": len(candidate_items),
        "matched_count": len(pairs),
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "word_fidelity": word_totals,
        "character_fidelity": {
            "reference_characters": character_reference,
            "errors": character_errors,
            "cer": _rate(character_errors, character_reference),
        },
        "structured_fields": field_totals,
        "unmatched_gold": [
            {"index": index, "label": item.get(_IDENTITY_FIELD[collection], "")}
            for index, item in enumerate(gold_items)
            if index not in matched_gold
        ],
        "unmatched_candidate": [
            {"index": index, "label": item.get(_IDENTITY_FIELD[collection], "")}
            for index, item in enumerate(candidate_items)
            if index not in matched_candidate
        ],
        "pairs": pair_details,
    }


def score_editions(
    gold: dict[str, Any],
    candidate: dict[str, Any],
    mapping: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Score final artifacts; fuzzy matching is never used implicitly."""
    if gold.get("edition_date") != candidate.get("edition_date"):
        raise ValueError("gold and candidate edition dates differ")
    mapping_method = "manual_reviewed_indices" if mapping is not None else "exact_normalized_fingerprint"
    collections = {}
    for collection in _COLLECTIONS:
        gold_items = list(gold.get(collection) or [])
        candidate_items = list(candidate.get(collection) or [])
        pairs = (
            _manual_pairs(mapping or {}, collection, len(gold_items), len(candidate_items))
            if mapping is not None
            else _exact_pairs(gold_items, candidate_items, collection)
        )
        collections[collection] = _collection_score(
            gold_items, candidate_items, collection, pairs
        )

    return {
        "schema_version": 1,
        "edition_date": gold.get("edition_date"),
        "mapping_method": mapping_method,
        "mapping_warning": (
            "Indices must have been manually reviewed against source scans."
            if mapping is not None
            else "Only exact normalized identity+body matches are scored; unmatched items are not fuzzily paired."
        ),
        "publication_info_exact": gold.get("publication_info", "")
        == candidate.get("publication_info", ""),
        "visual_file_counts": {
            "gold": sum(
                len(item.get("image_files") or [])
                for collection in _COLLECTIONS[:2]
                for item in gold.get(collection, [])
            ),
            "candidate": sum(
                len(item.get("image_files") or [])
                for collection in _COLLECTIONS[:2]
                for item in candidate.get(collection, [])
            ),
        },
        "collections": collections,
    }


def _markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Frozen Gold Comparison",
        "",
        f"- Edition: `{report['edition_date']}`",
        f"- Mapping: `{report['mapping_method']}`",
        f"- Publication metadata exact: `{report['publication_info_exact']}`",
        "",
        "| Collection | Gold | Candidate | Matched | Precision | Recall | F1 | WER | CER |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for name in _COLLECTIONS:
        score = report["collections"][name]
        lines.append(
            f"| {name} | {score['gold_count']} | {score['candidate_count']} | "
            f"{score['matched_count']} | {score['precision']:.3f} | "
            f"{score['recall']:.3f} | {score['f1']:.3f} | "
            f"{score['word_fidelity']['wer']:.3f} | "
            f"{score['character_fidelity']['cer']:.3f} |"
        )
    lines.extend(["", report["mapping_warning"], ""])
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Compare one final candidate edition.json with frozen gold"
    )
    parser.add_argument("--gold-edition", required=True)
    parser.add_argument("--candidate-edition", required=True)
    parser.add_argument("--mapping-json")
    parser.add_argument("--output-json")
    parser.add_argument("--output-md")
    args = parser.parse_args(argv)

    gold = json.loads(Path(args.gold_edition).read_text(encoding="utf-8"))
    candidate = json.loads(Path(args.candidate_edition).read_text(encoding="utf-8"))
    mapping = (
        json.loads(Path(args.mapping_json).read_text(encoding="utf-8"))
        if args.mapping_json
        else None
    )
    report = score_editions(gold, candidate, mapping)
    encoded = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if args.output_json:
        Path(args.output_json).write_text(encoded, encoding="utf-8")
    else:
        print(encoded, end="")
    if args.output_md:
        Path(args.output_md).write_text(_markdown(report), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
