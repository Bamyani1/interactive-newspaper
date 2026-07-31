"""Visual-region metadata retained from detector through assignment."""

from __future__ import annotations

from dataclasses import dataclass

Region = tuple[int, int, int, int]


@dataclass(frozen=True)
class RegionProposal:
    bounds: Region
    detector: str
    class_name: str
    confidence: float


class VisualRegionSet(list[Region]):
    def __init__(self, proposals: list[RegionProposal]):
        super().__init__(proposal.bounds for proposal in proposals)
        self.proposals = tuple(proposals)


__all__ = ["Region", "RegionProposal", "VisualRegionSet"]
