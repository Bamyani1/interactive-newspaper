#!/usr/bin/env python3
"""
API Usage Tracker
Tracks and logs all API calls with cost estimation and approval workflow.
"""
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.prompt import Confirm

console = Console()

# Pricing per 1M tokens (updated Jan 2025)
# See: https://ai.google.dev/pricing
PRICING = {
    "gemini-2.5-flash": {
        "input_per_1m": 0.15,
        "output_per_1m": 0.60,
    },
    "gemini-2.0-flash": {
        "input_per_1m": 0.10,
        "output_per_1m": 0.40,
    },
    "gemini-1.5-flash": {
        "input_per_1m": 0.075,
        "output_per_1m": 0.30,
    },
}

# Default model (must match config.py GEMINI_MODEL)
DEFAULT_MODEL = "gemini-2.5-flash"

# Estimated tokens per page (based on cost analysis)
EST_INPUT_TOKENS_PER_PAGE = 2015
EST_OUTPUT_TOKENS_PER_PAGE = 500

# Usage log file
USAGE_LOG_PATH = Path(__file__).parent / "api_usage.json"


class APITracker:
    """Tracks API usage and provides cost estimation."""

    def __init__(self, model: str = DEFAULT_MODEL):
        self.model = model
        self.session_calls = []
        self.session_start = datetime.now()
        self._load_history()

    def _load_history(self):
        """Load historical usage data."""
        if USAGE_LOG_PATH.exists():
            with open(USAGE_LOG_PATH) as f:
                self.history = json.load(f)
        else:
            self.history = {"total_calls": 0, "total_cost": 0.0, "sessions": []}

    def _save_history(self):
        """Save usage data to disk."""
        with open(USAGE_LOG_PATH, "w") as f:
            json.dump(self.history, f, indent=2, default=str)

    def estimate_cost(self, num_pages: int, model: Optional[str] = None) -> dict:
        """
        Estimate API cost for processing pages.

        Returns:
            dict with estimated tokens, cost, and breakdown
        """
        model = model or self.model
        pricing = PRICING.get(model, PRICING[DEFAULT_MODEL])

        input_tokens = num_pages * EST_INPUT_TOKENS_PER_PAGE
        output_tokens = num_pages * EST_OUTPUT_TOKENS_PER_PAGE

        input_cost = (input_tokens / 1_000_000) * pricing["input_per_1m"]
        output_cost = (output_tokens / 1_000_000) * pricing["output_per_1m"]
        total_cost = input_cost + output_cost

        return {
            "num_pages": num_pages,
            "api_calls": num_pages,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
            "input_cost": input_cost,
            "output_cost": output_cost,
            "total_cost": total_cost,
            "model": model,
        }

    def display_estimate(self, estimate: dict):
        """Display cost estimate in a formatted table."""
        table = Table(title="API Cost Estimate", show_header=True, header_style="bold cyan")
        table.add_column("Metric", style="dim")
        table.add_column("Value", justify="right")

        table.add_row("Model", estimate["model"])
        table.add_row("Pages to process", str(estimate["num_pages"]))
        table.add_row("API calls", str(estimate["api_calls"]))
        table.add_row("", "")
        table.add_row("Input tokens", f"{estimate['input_tokens']:,}")
        table.add_row("Output tokens", f"{estimate['output_tokens']:,}")
        table.add_row("Total tokens", f"{estimate['total_tokens']:,}")
        table.add_row("", "")
        table.add_row("Input cost", f"${estimate['input_cost']:.4f}")
        table.add_row("Output cost", f"${estimate['output_cost']:.4f}")
        table.add_row("[bold]Total cost[/bold]", f"[bold green]${estimate['total_cost']:.4f}[/bold green]")

        console.print(table)

    def display_history(self):
        """Display historical API usage."""
        table = Table(title="API Usage History", show_header=True, header_style="bold magenta")
        table.add_column("Metric", style="dim")
        table.add_column("Value", justify="right")

        table.add_row("Total API calls (all time)", str(self.history["total_calls"]))
        table.add_row("Total cost (all time)", f"${self.history['total_cost']:.4f}")
        table.add_row("Total sessions", str(len(self.history["sessions"])))

        console.print(table)

        # Show recent sessions
        if self.history["sessions"]:
            console.print("\n[bold]Recent Sessions:[/bold]")
            for session in self.history["sessions"][-5:]:
                console.print(
                    f"  {session['date']} - {session['calls']} calls, "
                    f"${session['cost']:.4f}, {session['edition']}"
                )

    def request_approval(self, estimate: dict, edition_id: str) -> bool:
        """
        Display estimate and request user approval.

        Returns:
            True if approved, False otherwise
        """
        console.print("\n")
        console.print(Panel(
            f"[bold yellow]API CALL REVIEW[/bold yellow]\n\n"
            f"Edition: {edition_id}\n"
            f"This operation will make [bold]{estimate['api_calls']}[/bold] API calls.",
            border_style="yellow"
        ))

        self.display_estimate(estimate)
        console.print("\n")
        self.display_history()
        console.print("\n")

        return Confirm.ask(
            f"[yellow]Proceed with {estimate['api_calls']} API calls "
            f"(~${estimate['total_cost']:.4f})?[/yellow]"
        )

    def log_call(self, page_num: int, input_tokens: int, output_tokens: int, success: bool):
        """Log an individual API call."""
        pricing = PRICING.get(self.model, PRICING[DEFAULT_MODEL])
        cost = (
            (input_tokens / 1_000_000) * pricing["input_per_1m"] +
            (output_tokens / 1_000_000) * pricing["output_per_1m"]
        )

        self.session_calls.append({
            "timestamp": datetime.now().isoformat(),
            "page": page_num,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost": cost,
            "success": success,
        })

    def finalize_session(self, edition_id: str):
        """Finalize and save session data."""
        if not self.session_calls:
            return

        total_calls = len(self.session_calls)
        total_cost = sum(c["cost"] for c in self.session_calls)
        successful = sum(1 for c in self.session_calls if c["success"])

        session_data = {
            "date": self.session_start.isoformat(),
            "edition": edition_id,
            "calls": total_calls,
            "successful": successful,
            "cost": total_cost,
            "details": self.session_calls,
        }

        self.history["total_calls"] += total_calls
        self.history["total_cost"] += total_cost
        self.history["sessions"].append(session_data)

        self._save_history()

        # Display session summary
        console.print(Panel(
            f"[bold green]Session Complete[/bold green]\n\n"
            f"API calls made: {total_calls}\n"
            f"Successful: {successful}\n"
            f"Session cost: ${total_cost:.4f}\n"
            f"Total cost (all time): ${self.history['total_cost']:.4f}",
            border_style="green"
        ))


def get_pages_needing_processing(edition_id: str) -> list[int]:
    """
    Determine which pages need API calls (don't have valid JSON yet).

    Returns:
        List of page numbers that need processing
    """
    from config import get_edition_paths

    paths = get_edition_paths(edition_id)
    pages_dir = paths["pages_dir"]

    if not pages_dir.exists():
        return []

    # Find all text files
    text_files = sorted(pages_dir.glob("page_*.txt"))
    pages_needing_api = []

    for text_file in text_files:
        import re
        page_num = int(re.search(r"page_(\d+)", text_file.name).group(1))

        # Check if valid JSON already exists
        output_file = pages_dir / f"page_{page_num:02d}_articles.json"
        needs_processing = True

        if output_file.exists() and output_file.stat().st_size > 100:
            try:
                with open(output_file) as f:
                    data = json.load(f)
                    if data.get("articles"):
                        needs_processing = False
            except (json.JSONDecodeError, ValueError, KeyError, OSError):
                pass

        if needs_processing:
            pages_needing_api.append(page_num)

    return pages_needing_api


# Singleton tracker instance
_tracker: Optional[APITracker] = None


def get_tracker(model: str = DEFAULT_MODEL) -> APITracker:
    """Get or create the global API tracker."""
    global _tracker
    if _tracker is None:
        _tracker = APITracker(model)
    return _tracker
