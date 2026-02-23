"""Diagnostics report summary printer."""

from __future__ import annotations

from ..contracts.diagnostics_models import PipelineReport


def print_summary(report: PipelineReport) -> None:
    report.print_summary()


__all__ = ["print_summary"]
