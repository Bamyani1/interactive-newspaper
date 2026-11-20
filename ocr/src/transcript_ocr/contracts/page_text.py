"""The page text Claude reads, block by block, before page structuring."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class PageText:
    """Every printed line on one page, as blocks in reading order."""

    raw_text: str
    paragraphs: list[str] = field(default_factory=list)
    paragraph_regions: list["PageParagraph"] = field(default_factory=list)


@dataclass(frozen=True)
class PageParagraph:
    """One block of page text with ephemeral normalized source-page geometry."""

    text: str
    bounds: tuple[float, float, float, float] | None = None
    # Layout class around the block, for the page text check; never sent to the model.
    label: str = ""
    # Whether the first printed line is indented.
    indented: bool | None = None


__all__ = ["PageParagraph", "PageText"]
