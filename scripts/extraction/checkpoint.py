"""
Checkpoint system for pipeline recovery.

Saves progress after each phase so the pipeline can resume
after interruptions without losing work or wasting API credits.

Checkpoint file: data/ocr-output/{edition}/.checkpoint.json
"""
import json
from datetime import datetime
from pathlib import Path
from typing import Optional

from config import get_edition_paths

PHASES = ["extract", "curate", "assemble"]
CHECKPOINT_FILENAME = ".checkpoint.json"


def get_checkpoint_path(edition_id: str) -> Path:
    """Get the checkpoint file path for an edition."""
    paths = get_edition_paths(edition_id)
    return paths["output_dir"] / CHECKPOINT_FILENAME


def load_checkpoint(edition_id: str) -> Optional[dict]:
    """
    Load checkpoint data for an edition.
    
    Returns:
        dict with checkpoint data, or None if no checkpoint exists.
    """
    checkpoint_path = get_checkpoint_path(edition_id)
    
    if not checkpoint_path.exists():
        return None
    
    try:
        with open(checkpoint_path, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        print(f"Warning: Failed to load checkpoint: {e}")
        return None


def save_checkpoint(
    edition_id: str,
    phase: str,
    completed: bool = False,
    phase_data: dict = None
) -> None:
    """
    Save checkpoint after completing or starting a phase.
    
    Args:
        edition_id: Edition being processed
        phase: Current phase (extract, curate, assemble)
        completed: Whether the phase completed successfully
        phase_data: Optional data to store for this phase
    """
    checkpoint_path = get_checkpoint_path(edition_id)
    
    # Ensure directory exists
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Load existing or create new
    existing = load_checkpoint(edition_id) or {
        "edition": edition_id,
        "started_at": datetime.now().isoformat(),
        "completed_phases": [],
        "phase_data": {},
    }
    
    # Update checkpoint
    existing["current_phase"] = phase
    existing["updated_at"] = datetime.now().isoformat()
    
    if completed and phase not in existing["completed_phases"]:
        existing["completed_phases"].append(phase)
    
    if phase_data:
        existing["phase_data"][phase] = phase_data
    
    # Write checkpoint
    with open(checkpoint_path, "w") as f:
        json.dump(existing, f, indent=2)


def clear_checkpoint(edition_id: str) -> None:
    """Remove checkpoint file after successful pipeline completion."""
    checkpoint_path = get_checkpoint_path(edition_id)
    
    if checkpoint_path.exists():
        checkpoint_path.unlink()


def get_resume_phase(edition_id: str) -> Optional[str]:
    """
    Determine which phase to resume from.
    
    Returns:
        Phase name to resume from, or None if no checkpoint exists.
    """
    checkpoint = load_checkpoint(edition_id)
    
    if not checkpoint:
        return None
    
    completed = checkpoint.get("completed_phases", [])
    
    # Find the first incomplete phase
    for phase in PHASES:
        if phase not in completed:
            return phase
    
    # All phases complete
    return None


def get_checkpoint_summary(edition_id: str) -> Optional[str]:
    """Get a human-readable summary of checkpoint status."""
    checkpoint = load_checkpoint(edition_id)
    
    if not checkpoint:
        return None
    
    completed = checkpoint.get("completed_phases", [])
    current = checkpoint.get("current_phase", "unknown")
    updated = checkpoint.get("updated_at", "unknown")
    
    return (
        f"Checkpoint found:\n"
        f"  Completed phases: {', '.join(completed) or 'none'}\n"
        f"  Current phase: {current}\n"
        f"  Last updated: {updated}"
    )
