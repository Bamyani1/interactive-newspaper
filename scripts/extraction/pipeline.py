#!/usr/bin/env python3
"""
Full extraction pipeline: Extract → Curate → Assemble

Usage:
    python pipeline.py --edition 1986-10-17
    python pipeline.py --batch editions.txt
    python pipeline.py --edition 1986-10-17 --skip-extract  # Only curate + assemble
    python pipeline.py --edition 1986-10-17 --dry-run       # Preview API calls without executing
    python pipeline.py --edition 1986-10-17 --no-confirm    # Skip confirmation prompt
    python pipeline.py --edition 1986-10-17 --resume        # Resume from checkpoint
"""
import argparse
import sys
from pathlib import Path

from rich.console import Console
from rich.panel import Panel

from extract import extract_edition
from curate import curate_edition
from assemble import assemble_edition
from config import get_edition_paths
from checkpoint import (
    save_checkpoint,
    clear_checkpoint,
    get_resume_phase,
    get_checkpoint_summary,
    PHASES,
)

console = Console()


def run_pipeline(
    edition_id: str,
    skip_extract: bool = False,
    skip_curate: bool = False,
    dry_run: bool = False,
    require_confirmation: bool = True,
    resume: bool = False,
):
    """Run the full extraction pipeline for an edition."""
    
    # Check for existing checkpoint if resuming
    resume_from = None
    if resume:
        summary = get_checkpoint_summary(edition_id)
        if summary:
            console.print(f"\n[yellow]{summary}[/yellow]\n")
            resume_from = get_resume_phase(edition_id)
            if resume_from:
                console.print(f"[cyan]Resuming from phase: {resume_from}[/cyan]\n")
            else:
                console.print("[green]All phases already complete![/green]")
                return
    
    console.print(Panel(
        f"[bold cyan]Processing Edition: {edition_id}[/bold cyan]"
        + (" [yellow](DRY RUN)[/yellow]" if dry_run else "")
        + (f" [cyan](RESUME from {resume_from})[/cyan]" if resume_from else ""),
        border_style="cyan"
    ))

    paths = get_edition_paths(edition_id)
    
    # Determine which phases to run
    run_extract = not skip_extract and (not resume_from or PHASES.index(resume_from) <= 0)
    run_curate = not skip_curate and (not resume_from or PHASES.index(resume_from) <= 1)
    run_assemble = not resume_from or PHASES.index(resume_from) <= 2

    # Phase 1: Extract
    if run_extract:
        console.print("\n[bold]═══ Phase 1: Extraction ═══[/bold]")
        if not dry_run:
            save_checkpoint(edition_id, "extract", completed=False)
            extract_edition(edition_id)
            save_checkpoint(edition_id, "extract", completed=True, phase_data={"status": "complete"})
        else:
            console.print("[dim]Would run extraction (Google Vision API)[/dim]")
    else:
        console.print("\n[dim]Skipping extraction phase[/dim]")

    # Phase 2: Curate (this is where Gemini API calls happen)
    if run_curate:
        console.print("\n[bold]═══ Phase 2: Curation ═══[/bold]")
        if not dry_run:
            save_checkpoint(edition_id, "curate", completed=False)
        curate_edition(
            edition_id,
            dry_run=dry_run,
            require_confirmation=require_confirmation
        )
        if not dry_run:
            save_checkpoint(edition_id, "curate", completed=True, phase_data={"status": "complete"})
        # If dry run, stop here since we're just previewing
        if dry_run:
            console.print("\n[dim]Dry run complete. No further phases executed.[/dim]")
            return
    else:
        console.print("\n[dim]Skipping curation phase[/dim]")

    # Phase 3: Assemble
    if run_assemble:
        console.print("\n[bold]═══ Phase 3: Assembly ═══[/bold]")
        save_checkpoint(edition_id, "assemble", completed=False)
        assemble_edition(edition_id)
        save_checkpoint(edition_id, "assemble", completed=True, phase_data={"status": "complete"})

    # Clear checkpoint on successful completion
    clear_checkpoint(edition_id)

    # Final summary
    console.print(Panel(
        f"[bold green]✓ Pipeline complete![/bold green]\n\n"
        f"Output: {paths['final_json']}",
        border_style="green"
    ))


def run_batch(
    batch_file: Path,
    skip_extract: bool = False,
    skip_curate: bool = False,
    dry_run: bool = False,
    require_confirmation: bool = True,
    resume: bool = False,
):
    """Process multiple editions from a batch file."""
    if not batch_file.exists():
        console.print(f"[red]Error: Batch file not found: {batch_file}[/red]")
        sys.exit(1)

    editions = [
        line.strip()
        for line in batch_file.read_text().splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]

    if not editions:
        console.print("[red]Error: No editions found in batch file[/red]")
        sys.exit(1)

    console.print(f"\n[bold]Batch processing {len(editions)} editions[/bold]")
    if dry_run:
        console.print("[yellow](DRY RUN - no API calls will be made)[/yellow]")
    if resume:
        console.print("[cyan](RESUME mode - will check for checkpoints)[/cyan]")
    console.print()

    for i, edition_id in enumerate(editions, 1):
        console.print(f"\n[cyan]{'═' * 60}[/cyan]")
        console.print(f"[bold]Edition {i}/{len(editions)}: {edition_id}[/bold]")
        console.print(f"[cyan]{'═' * 60}[/cyan]")

        try:
            run_pipeline(
                edition_id,
                skip_extract=skip_extract,
                skip_curate=skip_curate,
                dry_run=dry_run,
                require_confirmation=require_confirmation,
                resume=resume,
            )
        except Exception as e:
            console.print(f"[red]Error processing {edition_id}: {e}[/red]")
            # Save checkpoint on error so we can resume
            save_checkpoint(edition_id, "error", phase_data={"error": str(e)})
            continue

    console.print(f"\n[bold green]Batch complete! Processed {len(editions)} editions.[/bold green]")


def main():
    parser = argparse.ArgumentParser(description="Run the full extraction pipeline")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--edition", help="Single edition ID (e.g., 1986-10-17)")
    group.add_argument("--batch", type=Path, help="File with edition IDs (one per line)")

    parser.add_argument("--skip-extract", action="store_true", help="Skip extraction phase")
    parser.add_argument("--skip-curate", action="store_true", help="Skip curation phase")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview API calls and costs without executing"
    )
    parser.add_argument(
        "--no-confirm",
        action="store_true",
        help="Skip confirmation prompt before API calls"
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume from checkpoint if available"
    )

    args = parser.parse_args()

    if args.batch:
        run_batch(
            args.batch,
            skip_extract=args.skip_extract,
            skip_curate=args.skip_curate,
            dry_run=args.dry_run,
            require_confirmation=not args.no_confirm,
            resume=args.resume,
        )
    else:
        run_pipeline(
            args.edition,
            skip_extract=args.skip_extract,
            skip_curate=args.skip_curate,
            dry_run=args.dry_run,
            require_confirmation=not args.no_confirm,
            resume=args.resume,
        )


if __name__ == "__main__":
    main()
