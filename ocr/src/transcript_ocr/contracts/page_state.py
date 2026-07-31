"""Manifest-canvas page-state accounting contract."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class PageState(StrEnum):
    PASSED_CONTENT = "passed_content"
    PASSED_VISUAL = "passed_visual"
    CONFIRMED_BLANK = "confirmed_blank"
    FAILED = "failed"


PASSING_PAGE_STATES = frozenset(
    {PageState.PASSED_CONTENT, PageState.PASSED_VISUAL, PageState.CONFIRMED_BLANK}
)


@dataclass(frozen=True)
class PageOutcome:
    canvas_index: int
    state: PageState
    filename: str = ""
    reason: str = ""


def publication_ratio(outcomes: list[PageOutcome], manifest_canvas_count: int) -> float:
    if manifest_canvas_count <= 0:
        return 0.0
    return sum(outcome.state in PASSING_PAGE_STATES for outcome in outcomes) / manifest_canvas_count


def may_publish(outcomes: list[PageOutcome], manifest_canvas_count: int) -> bool:
    return publication_ratio(outcomes, manifest_canvas_count) >= 0.70


__all__ = [
    "PASSING_PAGE_STATES",
    "PageOutcome",
    "PageState",
    "may_publish",
    "publication_ratio",
]
