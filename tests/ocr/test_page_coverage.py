"""Tests for the check that page structuring kept every OCR block's text."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.contracts.content_models import Ad, Article, PageContent  # noqa: E402
from transcript_ocr.postprocessing.coverage import uncovered_blocks  # noqa: E402

BLOCK = (
    "The campus center will open within two years, said the president of the "
    "board on Tuesday."
)


def _page(body: str, ads: list[Ad] | None = None) -> PageContent:
    article = Article(
        headline="Center",
        author="",
        category="Campus News",
        continues_on="",
        continued_from="",
        body=body,
    )
    return PageContent(articles=[article], ads=ads or [])


def test_block_kept_in_full_is_covered():
    assert uncovered_blocks([BLOCK], _page("An intro line. " + BLOCK)) == []


def test_dropped_sentence_flags_its_block():
    block = BLOCK + " Ground breaking is set for May, and the cost has risen twice since the plan began."

    assert uncovered_blocks([block], _page(BLOCK)) == [block]


def test_short_blocks_and_rejoined_hyphens_are_not_flagged():
    blocks = [
        "Continued on page 6",
        "the admis-\nsions office said on Monday that the rate rose again this fall",
    ]
    page = _page("The admissions office said on Monday that the rate rose again this fall.")

    assert uncovered_blocks(blocks, page) == []


def test_ad_text_counts_as_covered():
    ad = "Fork and Fingers Restaurant open daily for lunch and dinner on Sandusky Street"

    page = _page("Unrelated story text.", ads=[Ad(business_name="Fork & Fingers", body=ad)])

    assert uncovered_blocks([ad], page) == []


def test_signature_moved_into_the_byline_fields_counts_as_covered():
    signature = "Bernard Murchland Department of Philosophy Coeditor, The Civic Arts Review"
    page = _page("Letter text.")
    page.articles[0].author = "Bernard Murchland"
    page.articles[0].writer_position = "Department of Philosophy, Coeditor, The Civic Arts Review"

    assert uncovered_blocks([signature], page) == []
