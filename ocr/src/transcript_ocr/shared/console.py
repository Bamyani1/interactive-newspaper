"""Centralized rich-console output for the OCR pipeline.

Wraps the ``rich`` library to provide colour-coded status lines, progress
bars, and summary tables.  Auto-detects TTY — when piped to a file the
output degrades to clean plain text.  Set ``OCR_FORCE_PLAIN=1`` to
override explicitly.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import TYPE_CHECKING, Generator

from rich.console import Console
from rich.panel import Panel
from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    SpinnerColumn,
    TextColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
)
from rich.table import Table
from rich.theme import Theme

if TYPE_CHECKING:
    from ..contracts.diagnostics_models import MergePassDiagnostics, PageDiagnostics, PipelineReport

_FORCE_PLAIN = os.getenv("OCR_FORCE_PLAIN", "0") == "1"

_theme = Theme(
    {
        "stage": "bold cyan",
        "success": "bold green",
        "warning": "bold yellow",
        "error": "bold red",
        "info": "dim",
        "file": "bold blue",
    }
)

_console = Console(
    theme=_theme,
    force_terminal=False if _FORCE_PLAIN else None,
)


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def banner(
    edition_date: str,
    page_count: int,
    output_path: str,
) -> None:
    """Print a startup banner with edition configuration."""
    lines = [
        f"  Edition:     {edition_date}",
        f"  Pages:       {page_count}",
        f"  Output:      {output_path}",
    ]
    _console.print(
        Panel("\n".join(lines), title="The Transcript Archive \u2014 OCR Pipeline", border_style="cyan")
    )


def stage(title: str, step: int, total: int) -> None:
    """Print a stage header like ``── Stage 1/3: Page extraction ──``."""
    _console.print(f"\n[stage]\u2500\u2500 Stage {step}/{total}: {title} \u2500\u2500[/stage]")


def status(message: str) -> None:
    """Print a top-level status line (e.g. 'Processing file\u2026')."""
    _console.print(f"\n{message}")


def substep(message: str) -> None:
    """Print an indented substep line."""
    _console.print(f"    -> {message}")


def success(message: str) -> None:
    """Print a green success line."""
    _console.print(f"[success]\u2713 {message}[/success]")


def warning(message: str) -> None:
    """Print a yellow warning line."""
    _console.print(f"[warning]\u26a0 {message}[/warning]")


def error(message: str) -> None:
    """Print a red error line."""
    _console.print(f"[error]\u2717 {message}[/error]")


def info(message: str) -> None:
    """Print a dim informational line."""
    _console.print(f"[info]    {message}[/info]")


def file_written(label: str, path: str) -> None:
    """Print a file-written indicator."""
    _console.print(f"    [file]{label}[/file] -> {path}")


# ---------------------------------------------------------------------------
# Progress bar
# ---------------------------------------------------------------------------

class _PlainProgress:
    """Non-TTY fallback that prints simple completion lines."""

    def __init__(self, total: int) -> None:
        self._total = total
        self._completed = 0

    def __enter__(self) -> _PlainProgress:
        return self

    def __exit__(self, *args: object) -> None:
        pass

    def add_task(self, description: str, total: int) -> int:
        self._total = total
        return 0

    def advance(self, task_id: int, advance: int = 1) -> None:
        self._completed += advance
        _console.print(f"  [{self._completed}/{self._total}] pages processed")

    def update(self, task_id: int, **kwargs: object) -> None:
        pass


@contextmanager
def page_progress(total: int) -> Generator:
    """Context manager yielding a progress tracker for the page-processing loop.

    In a TTY terminal this renders a live progress bar.  When piped (or when
    ``OCR_FORCE_PLAIN=1``) it prints simple ``[n/total]`` lines instead.
    """
    if _console.is_terminal and not _FORCE_PLAIN:
        progress = Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            MofNCompleteColumn(),
            TimeElapsedColumn(),
            TimeRemainingColumn(),
            console=_console,
        )
        with progress:
            yield progress
    else:
        yield _PlainProgress(total)


# ---------------------------------------------------------------------------
# Summary tables
# ---------------------------------------------------------------------------

def print_summary_table(report: PipelineReport) -> None:
    """Render the final pipeline summary, per-page table and merge pass."""
    _console.print()

    kv = Table(show_header=False, border_style="cyan", pad_edge=False)
    kv.add_column("Key", style="bold")
    kv.add_column("Value")

    kv.add_row("Edition", report.edition_date)
    mins, secs = divmod(report.total_time_seconds, 60)
    kv.add_row("Total time", f"{int(mins)}m {secs:.0f}s" if mins else f"{secs:.1f}s")
    kv.add_row("Pages", f"{report.pages_processed}/{report.pages_attempted} processed")
    kv.add_row(
        "Tokens (in/out)",
        f"{report.total_prompt_tokens:,} / {report.total_candidates_tokens:,}",
    )
    _console.print(kv)

    print_page_table(report.page_diagnostics)
    print_merge_summary(report.merge_pass)


def print_page_table(page_diagnostics: list[PageDiagnostics]) -> None:
    """Render the per-page results table."""
    if not page_diagnostics:
        return

    _console.print()
    table = Table(border_style="cyan")
    table.add_column("File", style="bold")
    table.add_column("Page", justify="center")
    table.add_column("Status", justify="center")
    table.add_column("Arts", justify="right")
    table.add_column("Ads", justify="right")
    table.add_column("Tokens", justify="right")
    table.add_column("Time", justify="right")

    total_arts = 0
    total_ads = 0
    total_tokens = 0
    ok_count = 0

    for pd in page_diagnostics:
        if pd.error:
            status_str = "[error]\u2717 FAIL[/error]"
        else:
            status_str = "[success]\u2713 OK[/success]"
            ok_count += 1

        total_tok = pd.gemini_tokens.total_tokens

        total_arts += pd.final_article_count
        total_ads += pd.final_ad_count
        total_tokens += total_tok

        time_str = f"{pd.total_time_seconds:.1f}s" if pd.total_time_seconds else "-"

        table.add_row(
            pd.filename,
            pd.page_number or "?",
            status_str,
            str(pd.final_article_count),
            str(pd.final_ad_count),
            f"{total_tok:,}",
            time_str,
        )

    table.add_section()
    table.add_row(
        "Total",
        "",
        f"{ok_count}/{len(page_diagnostics)}",
        str(total_arts),
        str(total_ads),
        f"{total_tokens:,}",
        "",
        style="bold",
    )
    _console.print(table)


def print_merge_summary(merge_pass: MergePassDiagnostics | None) -> None:
    """Render merge pass diagnostics as a table."""
    if merge_pass is None:
        return

    _console.print()
    mp = merge_pass
    if mp.error:
        error(f"Merge failed: {mp.error}")
        return

    table = Table(show_header=False, border_style="cyan", title="Merge Pass")
    table.add_column("Key", style="bold")
    table.add_column("Value")
    table.add_row("Articles", f"{mp.articles_before_merge} \u2192 {mp.articles_after_merge}")
    table.add_row("Multi-article groups", str(mp.multi_article_groups))
    table.add_row(
        "Tokens (in/out)",
        f"{mp.tokens.prompt_tokens:,} / {mp.tokens.candidates_tokens:,}",
    )
    table.add_row("Time", f"{mp.time_seconds:.1f}s")
    if mp.image_orphans_dropped or mp.empty_articles_removed:
        parts: list[str] = []
        if mp.image_orphans_dropped:
            parts.append(f"{mp.image_orphans_dropped} orphan captions")
        if mp.empty_articles_removed:
            parts.append(f"{mp.empty_articles_removed} empty articles removed")
        table.add_row("Sanitation", ", ".join(parts))
    _console.print(table)
