"""Claude reads the page text itself.

The page is cut into full-width strips; cuts across a page fall between
printed lines, while cuts down a page would split lines.  Each strip carries
some context above and below, tinted red.  Claude transcribes only the clear
area, so every line is read once.  The blocks it returns keep their position
on the page, which is what page structuring expects.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, replace
from difflib import SequenceMatcher

from PIL import Image
from pydantic import BaseModel, ConfigDict

from ..config.claude_client import fit_image_size
from ..config.model_calls import GenerationConfig, image_part, model_name
from ..contracts.diagnostics_models import PageDiagnostics, TokenUsage
from ..contracts.page_text import PageParagraph, PageText
from ..shared.console import substep
from ..shared.retry import generate_with_retry, require_parsed

_CONTEXT_PX = 120
_TINT = (255, 120, 120)
_TINT_ALPHA = 0.35
_STRAIGHT_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"'})
_PARAGRAPH_MARK = re.compile(r"^\s*¶\s*")

TEXT_READING_PROMPT = """\
You are transcribing a scanned page of The Transcript, a college newspaper, \
for an archive. The image is one horizontal strip of the page. The strip's own \
area is clear. Any band above or below it is tinted red and is context only.

Transcribe every line of text in the clear area, exactly as it appears:
- Include everything: headlines, decks, bylines, body text, captions, pull \
quotes, page headers and footers, page numbers, ad copy, prices, phone numbers, \
fine print, and text in boxes or tables.
- Also include text that is drawn or styled rather than typeset: hand-lettered \
captions, text inside cartoons and illustrations (speech balloons, labels, \
signatures), and the words in logos, wordmarks and script lettering. Skip text \
on objects shown in photographs, such as cans, signs or clothing. Transcribe \
the words; do not describe the pictures.
- Include every line that has any part of its letters in the clear area, even \
a line cut by its edge; lines repeated at strip edges are removed afterwards. \
Skip lines that are entirely in a tinted band.
- Copy characters exactly: spelling, capitalization, punctuation, numbers and \
abbreviations as printed. This is an archive of the page as printed, so keep \
the paper's own mistakes: misspellings, repeated words, and quotation marks \
that are opened but never closed. Read each word letter by letter rather than \
recognizing it whole: a word printed with a missing, extra or wrong letter \
stays that way (a printed "recieve", "goverment" or "nevertheles" is copied \
as printed). Do not correct, modernize, summarize or complete text.
- Add nothing that is not printed: no closing quotation mark, comma, period or \
apostrophe that is not on the page. A speck or smudge is not punctuation. Keep \
each dash as printed; a long dash is not a hyphen.
- Give each printed line as its own entry in the block's lines, exactly as it \
breaks on the page, and keep end-of-line hyphens.
- Mark paragraph starts: in running text (articles, letters, briefs and \
captions), begin the entry of each line that is indented as the first line of \
a paragraph with "¶". This mark is the only thing you add. Check the left edge \
of every line, including the first line of each column and of the clear area: \
a line flush with the column's left edge gets no mark, even when it starts a \
sentence. Never mark headlines, bylines or centered lines.
- If a word is hard to read, give your best reading from the visible letters.
- For a table, keep each value next to its labels: transcribe it one item at \
a time (an item is the product, team, day or person a column or row \
describes), giving the item's heading and then each label with its value.

Return blocks in reading order: within a column top to bottom, columns left to \
right. A block is one paragraph, headline, byline, caption, or one \
self-contained piece of ad copy. Never join text from different columns or \
different articles into one block. Give each block's bounding box in pixels of \
this image: left, top, right, bottom."""


class ReadBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # One entry per printed line; a single text field let the model join lines.
    lines: list[str]
    left: int
    top: int
    right: int
    bottom: int


class StripReading(BaseModel):
    model_config = ConfigDict(extra="forbid")

    blocks: list[ReadBlock]


@dataclass(frozen=True)
class Strip:
    """Page-pixel rows: the strip's own area and the crop with context."""

    top: int
    bottom: int
    crop_top: int
    crop_bottom: int


def plan_strips(width: int, height: int) -> list[Strip]:
    """Fewest full-width strips that Claude sees without shrinking past the width limit."""
    target_width = fit_image_size(width, 1)[0]
    count = 1
    while True:
        edges = [round(index * height / count) for index in range(count + 1)]
        strips = [
            Strip(
                top=edges[index],
                bottom=edges[index + 1],
                crop_top=max(0, edges[index] - _CONTEXT_PX),
                crop_bottom=min(height, edges[index + 1] + _CONTEXT_PX),
            )
            for index in range(count)
        ]
        if all(
            fit_image_size(width, strip.crop_bottom - strip.crop_top)[0] == target_width
            for strip in strips
        ):
            return strips
        count += 1


def render_strip(page: Image.Image, strip: Strip) -> tuple[Image.Image, float]:
    """Crop, scale to Claude's limit, and tint the context bands."""
    crop = page.crop((0, strip.crop_top, page.width, strip.crop_bottom)).convert("RGB")
    size = fit_image_size(*crop.size)
    scale = size[0] / crop.width
    if size != crop.size:
        crop = crop.resize(size, Image.Resampling.LANCZOS)
    tint = Image.new("RGB", crop.size, _TINT)
    tinted = Image.blend(crop, tint, _TINT_ALPHA)
    own_top = round((strip.top - strip.crop_top) * scale)
    own_bottom = round((strip.bottom - strip.crop_top) * scale)
    tinted.paste(crop.crop((0, own_top, crop.width, own_bottom)), (0, own_top))
    return tinted, scale


def _straight_quotes(text: str) -> str:
    """Archive text uses straight quotes, as the published archive does."""
    text = text.replace("‘‘", '"').replace("’’", '"')
    # Old type set double quotes as two single quotes.
    return text.translate(_STRAIGHT_QUOTES).replace("''", '"')


def _split_paragraphs(lines: list[str]) -> list[tuple[int, list[str], bool]]:
    """Split a block at each line marked as an indented paragraph start.

    Returns (first line index, lines, first line indented) per paragraph.
    """
    paragraphs: list[tuple[int, list[str], bool]] = []
    for index, line in enumerate(lines):
        text, marks = _PARAGRAPH_MARK.subn("", line)
        if marks or not paragraphs:
            paragraphs.append((index, [], bool(marks)))
        paragraphs[-1][1].append(text)
    return paragraphs


def _under_same_column_block(block: PageParagraph, others: list[PageParagraph]) -> bool:
    """Another block of the strip ends just above this one, in the same column."""
    left, top, right, _bottom = block.bounds
    width = right - left
    for other in others:
        o_left, _o_top, o_right, o_bottom = other.bounds
        if (
            other is not block
            and abs(o_left - left) <= 0.015
            and min(right, o_right) - max(left, o_left) >= 0.5 * width
            and o_right - o_left <= 1.3 * width
            and top - 0.03 < o_bottom <= top + 0.002
        ):
            return True
    return False


def _flush_only_at_column_tops(blocks: list[PageParagraph]) -> list[PageParagraph]:
    """Keep a flush mark only where text may run on from elsewhere.

    Mid-column, the reader starts a block at a paragraph break and often misses
    its indent, so the block break is the better evidence.  At the top of a
    column or strip a block may carry on a paragraph; a single line there is
    more often a salutation or label than a paragraph's remainder.
    """
    return [
        replace(block, indented=None)
        if block.indented is False
        and ("\n" not in block.text or _under_same_column_block(block, blocks))
        else block
        for block in blocks
    ]


def _same_line(a: str, b: str) -> bool:
    a, b = (re.sub(r"\W+", "", line.casefold()) for line in (a, b))
    return bool(a) and SequenceMatcher(None, a, b).ratio() >= 0.85


def _drop_seam_repeats(
    upper: list[PageParagraph], lower: list[PageParagraph], seam: float, band: float
) -> list[PageParagraph]:
    """Both strips read a line that straddles their seam; keep the upper copy."""
    kept: list[PageParagraph] = []
    for block in lower:
        left, top, right, bottom = block.bounds
        lines = block.text.split("\n")
        indented = block.indented
        if top < seam + band:
            for above in upper:
                a_left, _a_top, a_right, a_bottom = above.bounds
                overlap = min(right, a_right) - max(left, a_left)
                if a_bottom < seam - band or overlap < 0.5 * min(right - left, a_right - a_left):
                    continue
                above_lines = above.text.split("\n")
                repeats = next(
                    (
                        count
                        for count in range(min(3, len(lines), len(above_lines)), 0, -1)
                        if all(map(_same_line, above_lines[-count:], lines[:count]))
                    ),
                    0,
                )
                if repeats:
                    top += (bottom - top) * repeats / len(lines)
                    lines = lines[repeats:]
                    # What is left carries on the paragraph the upper strip began.
                    indented = False
                    break
        text = "\n".join(lines)
        if text.strip():
            kept.append(
                PageParagraph(
                    text=text, bounds=(left, top, right, bottom), indented=indented
                )
            )
    return kept


def _page_bounds(
    block: ReadBlock, strip: Strip, scale: float, page: Image.Image
) -> tuple[float, float, float, float]:
    def clamp(value: float) -> float:
        return min(max(value, 0.0), 1.0)

    return (
        clamp(block.left / scale / page.width),
        clamp((strip.crop_top + block.top / scale) / page.height),
        clamp(block.right / scale / page.width),
        clamp((strip.crop_top + block.bottom / scale) / page.height),
    )


def read_page_text(
    client,
    page: Image.Image,
    *,
    save_prefix: str | None = None,
    diag: PageDiagnostics | None = None,
) -> PageText:
    """Read every printed line on the page, strip by strip."""
    config = GenerationConfig(
        system_instruction=TEXT_READING_PROMPT,
        response_mime_type="application/json",
        response_schema=StripReading,
        max_output_tokens=65536,
    )
    paragraphs: list[PageParagraph] = []
    saved: list[dict] = []
    upper: list[PageParagraph] = []
    strips = plan_strips(page.width, page.height)
    for index, strip in enumerate(strips, start=1):
        image, scale = render_strip(page, strip)
        if save_prefix:
            image.save(f"{save_prefix}.strip-{index}.png")
        response = generate_with_retry(
            client,
            model=model_name("text_reading"),
            contents=[image_part(image), "Transcribe the clear area of this strip."],
            config=config,
            stage="text_reading",
            response_validator=lambda candidate: getattr(candidate, "parsed", None) is not None,
        )
        reading: StripReading = require_parsed(response, stage="text_reading")
        usage = response.usage_metadata
        if diag is not None and usage:
            diag.reading_tokens = diag.reading_tokens + TokenUsage.from_metadata(usage)
        tokens = (
            f"{usage.prompt_token_count} in, {usage.candidates_token_count} out"
            if usage
            else "unavailable"
        )
        substep(
            f"Read strip {index}/{len(strips)}: {len(reading.blocks)} block(s), "
            f"tokens {tokens}"
        )
        blocks: list[PageParagraph] = []
        for block in reading.blocks:
            # A block that runs two printed paragraphs together is split at the indent.
            left, top, right, bottom = _page_bounds(block, strip, scale, page)
            line_height = (bottom - top) / max(len(block.lines), 1)
            for start, lines, indented in _split_paragraphs(block.lines):
                text = _straight_quotes("\n".join(lines))
                if text.strip():
                    bounds = (
                        left,
                        top + start * line_height,
                        right,
                        top + (start + len(lines)) * line_height,
                    )
                    blocks.append(PageParagraph(text=text, bounds=bounds, indented=indented))
        blocks = _flush_only_at_column_tops(blocks)
        if upper:
            blocks = _drop_seam_repeats(
                upper, blocks, seam=strip.top / page.height, band=_CONTEXT_PX / page.height
            )
        paragraphs.extend(blocks)
        saved.extend(
            {"strip": index, "text": b.text, "bounds": b.bounds, "indented": b.indented}
            for b in blocks
        )
        upper = blocks
    if save_prefix:
        with open(f"{save_prefix}.claude-read.json", "w", encoding="utf-8") as handle:
            json.dump(saved, handle, indent=1, ensure_ascii=False)
    texts = [paragraph.text for paragraph in paragraphs]
    return PageText(
        raw_text="\n\n".join(texts),
        paragraphs=texts,
        paragraph_regions=paragraphs,
    )


__all__ = ["StripReading", "plan_strips", "read_page_text", "render_strip"]
