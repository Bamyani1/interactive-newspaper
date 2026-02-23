"""Tests for _best_body() order-preserving deduplication."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.merging.llm_merge import _best_body


def test_single_body_returned_as_is():
    assert _best_body(["Hello world"]) == "Hello world"


def test_empty_list_returns_empty_string():
    assert _best_body([]) == ""


def test_distinct_bodies_preserve_input_order():
    page3 = "They asked two or three times Friday night when they were to stand trial."
    page5 = "Hooper cited the behavior and brutality of the policemen in the case."
    result = _best_body([page3, page5])
    assert result == f"{page3}\n\n{page5}"


def test_distinct_bodies_preserve_order_reversed_input():
    short = "A short body."
    long = "A much longer body with significantly more content that makes it the longer one."
    result = _best_body([short, long])
    assert result == f"{short}\n\n{long}"


def test_duplicate_bodies_keep_longer():
    short_ver = "The quick brown fox jumps over the lazy dog."
    long_ver = "The quick brown fox jumps over the lazy dog. Extra content here."
    result = _best_body([short_ver, long_ver])
    assert result == long_ver


def test_duplicate_bodies_keep_longer_reversed():
    short_ver = "The quick brown fox jumps over the lazy dog."
    long_ver = "The quick brown fox jumps over the lazy dog. Extra content here."
    result = _best_body([long_ver, short_ver])
    assert result == long_ver


def test_three_bodies_two_duplicates():
    body_a = "First distinct body about topic A with enough content."
    body_b_short = "Second body about topic B is here."
    body_b_long = "Second body about topic B is here. With additional details."
    result = _best_body([body_a, body_b_short, body_b_long])
    assert result == f"{body_a}\n\n{body_b_long}"
