#!/bin/bash
set -euo pipefail

# ── process-unprocessed.sh ──────────────────────────────────────
# Batch orchestrator: discovers all editions in ocr/inbox/
# and processes each through the full pipeline.
#
# Usage:
#   scripts/process-unprocessed.sh              # sequential (default)
#   scripts/process-unprocessed.sh --parallel 3 # 3 concurrent workers
#   scripts/process-unprocessed.sh --dry-run    # list editions without processing
#
# Each edition runs through: OCR → enrich → cleanup → seed → embed
# Successfully processed editions are moved to ocr/done/.
# ────────────────────────────────────────────────────────────────

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
UNPROCESSED_DIR="$ROOT_DIR/ocr/inbox"
SCRIPT="$ROOT_DIR/scripts/process-edition.sh"

# ── Args ────────────────────────────────────────────────────────

PARALLEL=1
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --parallel)
      PARALLEL="${2:-3}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: scripts/process-unprocessed.sh [--parallel N] [--dry-run]"
      exit 1
      ;;
  esac
done

# ── Discover editions ───────────────────────────────────────────

if [[ ! -d "$UNPROCESSED_DIR" ]]; then
  echo "No unprocessed directory found at: $UNPROCESSED_DIR"
  exit 0
fi

EDITIONS=()
while IFS= read -r dir; do
  EDITIONS+=("$dir")
done < <(find "$UNPROCESSED_DIR" -mindepth 1 -maxdepth 1 -type d | sort)

if [[ ${#EDITIONS[@]} -eq 0 ]]; then
  echo "No editions found in $UNPROCESSED_DIR"
  exit 0
fi

echo "Found ${#EDITIONS[@]} edition(s) to process:"
for dir in "${EDITIONS[@]}"; do
  DATE=$(basename "$dir" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)
  PAGE_COUNT=$(find "$dir" -name "*.tif" 2>/dev/null | wc -l | tr -d ' ')
  echo "  - $DATE ($PAGE_COUNT pages)"
done
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  echo "(dry run — no processing)"
  exit 0
fi

# ── Process editions ────────────────────────────────────────────

SUCCESSES=0
FAILURES=0
FAILED_DATES=""
TOTAL=${#EDITIONS[@]}
START_TIME=$SECONDS

if [[ "$PARALLEL" -eq 1 ]]; then
  # Sequential processing
  echo "Processing sequentially..."
  echo ""

  for dir in "${EDITIONS[@]}"; do
    DATE=$(basename "$dir" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)
    if bash "$SCRIPT" "$dir"; then
      SUCCESSES=$((SUCCESSES + 1))
    else
      FAILURES=$((FAILURES + 1))
      FAILED_DATES="$FAILED_DATES $DATE"
      echo "FAILED: $DATE — continuing with next edition..."
    fi
    echo ""
  done
else
  # Parallel processing with xargs
  echo "Processing with $PARALLEL parallel workers..."
  echo "Logs: ocr/runs/<date>/pipeline.log"
  echo ""

  RESULTS_DIR=$(mktemp -d)

  process_one() {
    local dir="$1"
    local date
    date=$(basename "$dir" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)
    local log_dir="$ROOT_DIR/ocr/runs/$date"
    mkdir -p "$log_dir"

    if bash "$SCRIPT" "$dir" > "$log_dir/pipeline.log" 2>&1; then
      echo "$date" >> "$RESULTS_DIR/successes"
      echo "  ✓ $date completed"
    else
      echo "$date" >> "$RESULTS_DIR/failures"
      echo "  ✗ $date FAILED (see ocr/runs/$date/pipeline.log)"
    fi
  }
  export -f process_one
  export ROOT_DIR SCRIPT

  printf '%s\n' "${EDITIONS[@]}" | xargs -P "$PARALLEL" -I {} bash -c 'process_one "$@"' _ {}

  if [[ -f "$RESULTS_DIR/successes" ]]; then
    SUCCESSES=$(wc -l < "$RESULTS_DIR/successes" | tr -d ' ')
  fi
  if [[ -f "$RESULTS_DIR/failures" ]]; then
    FAILURES=$(wc -l < "$RESULTS_DIR/failures" | tr -d ' ')
    FAILED_DATES=$(cat "$RESULTS_DIR/failures" | tr '\n' ' ')
  fi
  rm -rf "$RESULTS_DIR"
fi

# ── Summary ─────────────────────────────────────────────────────

ELAPSED=$((SECONDS - START_TIME))
MINUTES=$((ELAPSED / 60))
SECS=$((ELAPSED % 60))

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "Batch complete in ${MINUTES}m ${SECS}s"
echo "  Succeeded: $SUCCESSES / $TOTAL"
echo "  Failed:    $FAILURES / $TOTAL"
if [[ -n "$FAILED_DATES" ]]; then
  echo "  Failed editions:$FAILED_DATES"
fi
echo "════════════════════════════════════════════════════════════════"

[[ "$FAILURES" -eq 0 ]]
