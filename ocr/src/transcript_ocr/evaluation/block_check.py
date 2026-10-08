"""Offline check of OCR block building on a run's saved Document AI responses.

Reads a work root written with OCR_SAVE_DOCAI_JSON=1 (scripts/ocr/eval-edition.sh
sets it) and rebuilds every page's blocks with and without layout walls, at no
API cost. Against a gold edition, a word pair inside a block that never occurs
in gold marks words spliced from different places.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

from PIL import Image

from ..detection.american_stories_provider import detect_layout_boxes
from ..recognition.docai_provider import _extract_paragraph_regions

_WORD_RE = re.compile(r"[a-z0-9]+")


def _words(text: str) -> list[str]:
    return _WORD_RE.findall(re.sub(r"-\s*\n\s*", "", text or "").lower())


def _bigrams(text: str) -> list[tuple[str, str]]:
    words = _words(text)
    return list(zip(words, words[1:]))


def gold_bigrams(gold: dict) -> set[tuple[str, str]]:
    """Every adjacent word pair printed anywhere in the gold edition."""
    texts = [gold.get("publication_info", "")]
    for article in gold.get("articles", []):
        texts += [article.get("headline", ""), article.get("author", ""), article.get("body", "")]
        texts += [image.get("caption", "") for image in article.get("images") or []]
    for ad in gold.get("ads", []):
        texts += [ad.get("business_name", ""), ad.get("body", "")]
    for item in gold.get("other_content", []):
        texts += [item.get("title", ""), item.get("body", "")]
    return {pair for text in texts for pair in _bigrams(text)}


def check_page(document, layout, gold: set[tuple[str, str]] | None) -> dict:
    plain = _extract_paragraph_regions(document)
    walled = _extract_paragraph_regions(document, layout)
    raw = Counter(_words(document.text))
    result = {"layout_boxes": len(layout), "changed": []}
    for name, blocks in (("plain", plain), ("layout", walled)):
        found = Counter(_words("\n".join(block.text for block in blocks)))
        result[name] = {
            "blocks": len(blocks),
            "lost_words": sum((raw - found).values()),
            "spliced_pairs": (
                sum(pair not in gold for block in blocks for pair in _bigrams(block.text))
                if gold is not None
                else None
            ),
        }
    before = {block.text for block in plain}
    result["changed"] = [
        f"[{block.label or '-'}] {block.text}" for block in walled if block.text not in before
    ]
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("work_root", help="run work root holding canvas-*/<page>.docai.json")
    parser.add_argument("--gold-edition", help="gold-edition.json to count spliced word pairs")
    parser.add_argument("-v", "--verbose", action="store_true", help="print changed blocks")
    args = parser.parse_args(argv)

    from google.cloud import documentai

    gold = None
    if args.gold_edition:
        gold = gold_bigrams(json.loads(Path(args.gold_edition).read_text(encoding="utf-8")))
    responses = sorted(Path(args.work_root).glob("canvas-*/*.docai.json"))
    if not responses:
        print(f"no saved Document AI responses under {args.work_root}")
        return 1
    totals = Counter()
    for response in responses:
        image_path = response.with_name(response.name.replace(".docai.json", ".ocr.png"))
        document = documentai.Document.from_json(
            response.read_text(encoding="utf-8"), ignore_unknown_fields=True
        )
        with Image.open(image_path) as image:
            layout = detect_layout_boxes(image)
        page = check_page(document, layout, gold)
        line = [f"{response.parent.name}: {page['layout_boxes']} layout boxes"]
        for name in ("plain", "layout"):
            stats = page[name]
            spliced = "" if gold is None else f", {stats['spliced_pairs']} spliced pairs"
            line.append(f"{name} {stats['blocks']} blocks{spliced}, {stats['lost_words']} lost words")
            totals[f"{name}_spliced"] += stats["spliced_pairs"] or 0
            totals[f"{name}_lost"] += stats["lost_words"]
        line.append(f"{len(page['changed'])} blocks changed")
        print(" | ".join(line))
        if args.verbose:
            for text in page["changed"]:
                print("    + " + text.replace("\n", " / ")[:400])
    if gold is not None:
        print(
            f"TOTAL spliced pairs: plain {totals['plain_spliced']}, layout {totals['layout_spliced']}; "
            f"lost words: plain {totals['plain_lost']}, layout {totals['layout_lost']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
