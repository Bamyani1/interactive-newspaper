"""Tests for rebuilding Document AI tokens into column-pure text blocks."""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.recognition.docai_columns import Token, column_blocks  # noqa: E402
from transcript_ocr.recognition.docai_provider import (  # noqa: E402
    _extract_paragraph_regions,
)

LEFT = [
    "the campus center",
    "will open within",
    "two years said the",
    "president of the",
    "board on tuesday",
    "after a long vote",
    "in the main hall",
    "of old merrick",
]
RIGHT = [
    "swimmers took six",
    "events at kenyon",
    "while divers won",
    "both boards and",
    "coach smith was",
    "pleased by every",
    "single relay team",
    "in the pool today",
]


def _page(columns, *, top=100.0, pitch=36.0, height=44.0, char=16.0, space=14.0):
    """Lay out columns of left-aligned lines. Text order is row-major across
    columns, like Document AI's spliced lines. A leading ">" indents a line."""
    tokens: list[Token] = []
    text = ""
    for row in range(max(len(lines) for _, lines in columns)):
        for x0, lines in columns:
            if row >= len(lines):
                continue
            line = lines[row]
            x = x0 + (40.0 if line.startswith(">") else 0.0)
            words = line.lstrip(">").split()
            for i, word in enumerate(words):
                raw = word + (" " if i < len(words) - 1 else "\n")
                start = len(text)
                text += raw
                y = top + row * pitch
                width = char * len(word)
                tokens.append(
                    Token(raw, (x, y, x + width, y + height), start, len(text))
                )
                x += width + space
    return tokens


def test_adjacent_columns_are_not_spliced():
    blocks = column_blocks(_page([(100.0, LEFT), (500.0, RIGHT)]))

    assert [text for text, _ in blocks] == ["\n".join(LEFT), "\n".join(RIGHT)]


def test_paragraph_indent_starts_a_new_block():
    lines = LEFT[:4] + [">" + LEFT[4]] + LEFT[5:]

    blocks = column_blocks(_page([(100.0, lines)]))

    assert [text for text, _ in blocks] == [
        "\n".join(LEFT[:4]),
        "\n".join(LEFT[4:]),
    ]


def test_wide_justified_gap_inside_a_column_stays_one_line():
    tokens = _page([(100.0, LEFT[:4] + ["fence"] + LEFT[4:])])
    # Justification spreads a short line: a 120px gap, but text above and below covers it.
    y = 100.0 + 4 * 36.0
    tokens.append(Token("erected\n", (300.0, y, 412.0, y + 44.0), 900, 908))

    texts = [text for text, _ in column_blocks(tokens)]

    assert len(texts) == 1
    assert "fence erected" in texts[0].splitlines()


def test_isolated_headline_is_not_split_into_words():
    headline = [
        Token("Delaware ", (100.0, 0.0, 300.0, 90.0), 0, 9),
        Token("to ", (340.0, 0.0, 400.0, 90.0), 9, 12),
        Token("feel\n", (440.0, 0.0, 560.0, 90.0), 12, 17),
    ]

    blocks = column_blocks(headline + _page([(100.0, LEFT), (500.0, RIGHT)], top=200.0))

    assert blocks[0][0] == "Delaware to feel"


def test_columns_read_left_to_right_under_a_wide_headline():
    headline = [
        Token("Club ", (100.0, 0.0, 300.0, 90.0), 0, 5),
        Token("rugby\n", (340.0, 0.0, 600.0, 90.0), 5, 11),
    ]
    # The right column starts higher than the left one, as in a brick layout.
    body = _page([(100.0, LEFT)], top=400.0) + _page([(500.0, RIGHT)], top=364.0)

    texts = [text for text, _ in column_blocks(headline + body)]

    assert texts == ["Club rugby", "\n".join(LEFT), "\n".join(RIGHT)]


def test_narrow_gutter_between_headlines_still_splits():
    left, right = LEFT + LEFT[:4], RIGHT + RIGHT[:4]
    above = [
        Token("Ohio ", (100.0, 100.0, 300.0, 190.0), 0, 5),
        Token("prospects\n", (340.0, 100.0, 700.0, 190.0), 5, 15),
    ]
    below = [
        Token("Dining ", (100.0, 660.0, 330.0, 750.0), 900, 907),
        Token("room\n", (370.0, 660.0, 600.0, 750.0), 907, 912),
    ]
    # A 38px gutter; both 7-line bands from mid-story reach a spanning headline.
    body = _page([(100.0, left), (420.0, right)], top=200.0)

    texts = [text for text, _ in column_blocks(above + body + below)]

    assert texts == [
        "Ohio prospects",
        "\n".join(left),
        "\n".join(right),
        "Dining room",
    ]


def test_gutter_splits_under_a_headline_that_dips_into_the_first_line():
    # The headline box ends 4px inside the first body line, as Document AI
    # boxes often do; the first line must still split at the gutter.
    headline = [
        Token("Rugby ", (100.0, 100.0, 300.0, 204.0), 0, 6),
        Token("club\n", (340.0, 100.0, 700.0, 204.0), 6, 11),
    ]
    body = _page([(100.0, LEFT), (420.0, RIGHT)], top=200.0)

    texts = [text for text, _ in column_blocks(headline + body)]

    assert texts == ["Rugby club", "\n".join(LEFT), "\n".join(RIGHT)]


def _stretched_gutter_page():
    """Columns 38px apart whose last word on every third line has a box
    reaching 5px short of the next column, as noisy Document AI boxes do."""
    tokens = _page([(100.0, LEFT), (420.0, RIGHT)])
    for row in (1, 4, 7):
        y = 100.0 + row * 36.0
        last = max(
            (t for t in tokens if t.box[1] == y and t.box[0] < 420.0),
            key=lambda t: t.box[2],
        )
        tokens[tokens.index(last)] = Token(
            last.text, (last.box[0], y, 415.0, y + 44.0), last.start, last.end
        )
    return tokens


def test_layout_regions_split_columns_the_gutter_test_misses():
    tokens = _stretched_gutter_page()
    columns = ["\n".join(LEFT), "\n".join(RIGHT)]
    assert [text for text, _ in column_blocks(tokens)] != columns

    regions = [(90.0, 90.0, 417.0, 450.0), (418.0, 90.0, 800.0, 450.0)]

    assert [text for text, _ in column_blocks(tokens, regions)] == columns


def test_token_outside_every_region_still_joins_its_line():
    # The left region stops short of the longest lines' last words.
    regions = [(90.0, 90.0, 300.0, 450.0), (418.0, 90.0, 800.0, 450.0)]

    blocks = column_blocks(_page([(100.0, LEFT), (420.0, RIGHT)]), regions)

    assert [text for text, _ in blocks] == ["\n".join(LEFT), "\n".join(RIGHT)]


def test_word_returned_twice_as_overlapping_tokens_is_kept_once():
    tokens = _page([(100.0, LEFT)])
    first = tokens[0]
    # Document AI sometimes repeats a word as a second, slightly shifted token.
    tokens.append(
        Token("the\n", (first.box[0] - 2.0, first.box[1] + 3.0, first.box[2] + 1.0, first.box[3] + 3.0), 900, 904)
    )

    assert [text for text, _ in column_blocks(tokens)] == ["\n".join(LEFT)]


def test_headline_beside_body_text_is_not_joined_to_it():
    headline = [Token("Theta\n", (100.0, 100.0, 300.0, 190.0), 0, 6)]
    body = _page([(330.0, LEFT)], top=118.0)

    texts = [text for text, _ in column_blocks(headline + body)]

    assert "Theta" in texts
    assert "\n".join(LEFT) in texts


def test_tokens_without_a_break_join_without_a_space():
    tokens = [
        Token("ago", (100.0, 100.0, 148.0, 144.0), 0, 3),
        Token(". ", (148.0, 100.0, 156.0, 144.0), 3, 5),
        Token("Never\n", (170.0, 100.0, 250.0, 144.0), 5, 11),
    ]

    assert column_blocks(tokens)[0][0] == "ago. Never"


def _vertex(x, y):
    return SimpleNamespace(x=x, y=y)


def _docai_document(tokens, width, height):
    text = "".join(t.text for t in sorted(tokens, key=lambda t: t.start))
    page_tokens = [
        SimpleNamespace(
            layout=SimpleNamespace(
                text_anchor=SimpleNamespace(
                    text_segments=[
                        SimpleNamespace(start_index=t.start, end_index=t.end)
                    ]
                ),
                bounding_poly=SimpleNamespace(
                    normalized_vertices=[
                        _vertex(t.box[0] / width, t.box[1] / height),
                        _vertex(t.box[2] / width, t.box[1] / height),
                        _vertex(t.box[2] / width, t.box[3] / height),
                        _vertex(t.box[0] / width, t.box[3] / height),
                    ]
                ),
            )
        )
        for t in tokens
    ]
    page = SimpleNamespace(
        dimension=SimpleNamespace(width=width, height=height),
        tokens=page_tokens,
        paragraphs=[],
    )
    return SimpleNamespace(text=text, pages=[page])


def test_provider_builds_regions_from_token_geometry():
    width, height = 1000.0, 2000.0
    tokens = _page([(100.0, LEFT), (500.0, RIGHT)])
    document = _docai_document(tokens, width, height)

    regions = _extract_paragraph_regions(document)

    assert [r.text for r in regions] == ["\n".join(LEFT), "\n".join(RIGHT)]
    left_bounds = regions[0].bounds
    assert left_bounds is not None
    assert left_bounds[0] == 0.1
    assert left_bounds[1] == 100.0 / height


def test_each_block_carries_the_layout_class_around_it():
    width, height = 1000.0, 2000.0
    document = _docai_document(_page([(100.0, LEFT), (500.0, RIGHT)]), width, height)
    layout = [("article", (0.05, 0.0, 0.45, 1.0)), ("ad or cartoon", (0.45, 0.0, 0.95, 1.0))]

    regions = _extract_paragraph_regions(document, layout)

    assert [(r.text, r.label) for r in regions] == [
        ("\n".join(LEFT), "article"),
        ("\n".join(RIGHT), "ad or cartoon"),
    ]
