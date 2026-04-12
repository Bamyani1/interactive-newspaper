#!/bin/bash
set -euo pipefail

# ── process-unprocessed.sh ──────────────────────────────────────
# Batch orchestrator: discovers all editions in ocr/inbox/
# and processes each through the full pipeline.
#
# Usage:
#   scripts/ocr/process-unprocessed.sh                        # sequential (default)
#   scripts/ocr/process-unprocessed.sh --parallel 3           # 3 concurrent workers
#   scripts/ocr/process-unprocessed.sh --dry-run              # list editions without processing
#   scripts/ocr/process-unprocessed.sh --inbox /path/to/dir   # use custom inbox directory
#   scripts/ocr/process-unprocessed.sh --from-stage 4         # resume all editions from stage 4
#
# Each edition runs through: OCR (with ad enrichment) → image cleanup → R2 upload → DB seed (with embedding)
# Successfully processed editions are moved to ocr/done/.
#
# Exit codes from process-edition.sh: 10=OCR, 20=cleanup, 30=upload, 40=seed
# Writes batch report to: ocr/runs/batch-<timestamp>.json
# ────────────────────────────────────────────────────────────────

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
UNPROCESSED_DIR="$ROOT_DIR/ocr/inbox"
SCRIPT="$ROOT_DIR/scripts/ocr/process-edition.sh"

# ── Args ────────────────────────────────────────────────────────

PARALLEL=1
DRY_RUN=false
FROM_STAGE=""
WORKERS=""

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
    --inbox)
      UNPROCESSED_DIR="${2:-}"
      if [[ -z "$UNPROCESSED_DIR" ]]; then
        echo "ERROR: --inbox requires a directory path"
        exit 1
      fi
      shift 2
      ;;
    --from-stage)
      FROM_STAGE="${2:-}"
      if [[ -z "$FROM_STAGE" ]]; then
        echo "ERROR: --from-stage requires a stage number (1-4)"
        exit 1
      fi
      if ! [[ "$FROM_STAGE" =~ ^[1-4]$ ]]; then
        echo "ERROR: --from-stage must be 1, 2, 3, or 4"
        exit 1
      fi
      shift 2
      ;;
    --workers)
      WORKERS="${2:-}"
      if [[ -z "$WORKERS" ]]; then
        echo "ERROR: --workers requires a number"
        exit 1
      fi
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: scripts/ocr/process-unprocessed.sh [--parallel N] [--dry-run] [--inbox DIR] [--from-stage N] [--workers N]"
      exit 1
      ;;
  esac
done

# Build pass-through args for process-edition.sh
PASS_THROUGH_ARGS=""
if [[ -n "$FROM_STAGE" ]]; then
  PASS_THROUGH_ARGS="--from-stage $FROM_STAGE"
fi
if [[ -n "$WORKERS" ]]; then
  PASS_THROUGH_ARGS="$PASS_THROUGH_ARGS --workers $WORKERS"
fi

# ── Helpers ─────────────────────────────────────────────────────

decode_stage() {
  case "$1" in
    10) echo "ocr" ;;
    20) echo "cleanup" ;;
    30) echo "upload" ;;
    40) echo "seed" ;;
     0) echo "" ;;
     *) echo "unknown (exit $1)" ;;
  esac
}

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
  PAGE_COUNT=$(find "$dir" \( -name "*.tif" -o -name "*.tiff" -o -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" \) 2>/dev/null | wc -l | tr -d ' ')
  echo "  - $DATE ($PAGE_COUNT pages)"
done
echo ""

if [[ -n "$FROM_STAGE" ]]; then
  echo "Resuming from stage $FROM_STAGE (stages 1-$((FROM_STAGE - 1)) will be skipped)"
  echo ""
fi

if [[ -n "$WORKERS" ]]; then
  echo "Workers per edition: $WORKERS"
  echo ""
fi

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

BATCH_TS=$(date +%Y%m%d-%H%M%S)
RESULTS_FILE="$ROOT_DIR/ocr/runs/.batch-${BATCH_TS}-results.tmp"
mkdir -p "$ROOT_DIR/ocr/runs"

if [[ "$PARALLEL" -eq 1 ]]; then
  # Sequential processing
  echo "Processing sequentially..."
  echo ""

  for dir in "${EDITIONS[@]}"; do
    DATE=$(basename "$dir" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)
    EXIT_CODE=0
    # shellcheck disable=SC2086
    bash "$SCRIPT" "$dir" $PASS_THROUGH_ARGS || EXIT_CODE=$?
    echo "$DATE:$EXIT_CODE" >> "$RESULTS_FILE"
    if [[ $EXIT_CODE -eq 0 ]]; then
      SUCCESSES=$((SUCCESSES + 1))
    else
      FAILURES=$((FAILURES + 1))
      FAILED_DATES="$FAILED_DATES $DATE"
      STAGE=$(decode_stage $EXIT_CODE)
      echo "FAILED: $DATE (stage: ${STAGE}) — continuing with next edition..."
    fi
    echo ""
  done
else
  # Parallel processing with xargs
  echo "Processing with $PARALLEL parallel workers..."
  echo "Logs: ocr/runs/<date>/pipeline.log"
  echo ""

  XARGS_RESULTS_DIR=$(mktemp -d)
  trap 'rm -rf "$XARGS_RESULTS_DIR"' EXIT

  process_one() {
    local dir="$1"
    local date
    date=$(basename "$dir" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)
    local log_dir="$ROOT_DIR/ocr/runs/$date"
    mkdir -p "$log_dir"

    echo "  ▶ $date starting..."

    local exit_code=0
    # shellcheck disable=SC2086
    bash "$SCRIPT" "$dir" $PASS_THROUGH_ARGS_STR > "$log_dir/pipeline.log" 2>&1 || exit_code=$?

    # Write per-edition result file (no race condition — one file per date)
    echo "$exit_code" > "$XARGS_RESULTS_DIR/$date.result"

    if [[ $exit_code -eq 0 ]]; then
      # Extract article/ad counts from pipeline summary
      local arts=0 ads=0 secs=0
      if [[ -f "$log_dir/pipeline-summary.json" ]]; then
        arts=$(python3 -c "import json; print(json.load(open('$log_dir/pipeline-summary.json')).get('article_count',0))" 2>/dev/null) || arts=0
        ads=$(python3 -c "import json; print(json.load(open('$log_dir/pipeline-summary.json')).get('ad_count',0))" 2>/dev/null) || ads=0
        secs=$(python3 -c "import json; print(json.load(open('$log_dir/pipeline-summary.json')).get('total_seconds',0))" 2>/dev/null) || secs=0
      fi
      echo "  ✓ $date completed (${secs}s, ${arts} articles, ${ads} ads)"
    else
      echo "  ✗ $date FAILED (exit $exit_code, see ocr/runs/$date/pipeline.log)"
    fi
  }
  export -f process_one
  export ROOT_DIR SCRIPT XARGS_RESULTS_DIR
  export PASS_THROUGH_ARGS_STR="$PASS_THROUGH_ARGS"

  printf '%s\n' "${EDITIONS[@]}" | xargs -P "$PARALLEL" -I {} bash -c 'process_one "$@"' _ {}

  # Aggregate per-edition result files into RESULTS_FILE
  for result_file in "$XARGS_RESULTS_DIR"/*.result; do
    [[ -f "$result_file" ]] || continue
    rdate=$(basename "$result_file" .result)
    rcode=$(cat "$result_file")
    echo "$rdate:$rcode" >> "$RESULTS_FILE"
    if [[ "$rcode" -eq 0 ]]; then
      SUCCESSES=$((SUCCESSES + 1))
    else
      FAILURES=$((FAILURES + 1))
      FAILED_DATES="$FAILED_DATES $rdate"
    fi
  done
  rm -rf "$XARGS_RESULTS_DIR"
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
  echo "  Failed editions:"
  if [[ -f "$RESULTS_FILE" ]]; then
    while IFS=: read -r rdate rcode; do
      if [[ "$rcode" -ne 0 ]]; then
        STAGE=$(decode_stage "$rcode")
        echo "    - $rdate (stage: ${STAGE})"
      fi
    done < "$RESULTS_FILE"
  else
    echo "   $FAILED_DATES"
  fi
fi
echo "════════════════════════════════════════════════════════════════"

# ── Batch report ───────────────────────────────────────────────

BATCH_REPORT="$ROOT_DIR/ocr/runs/batch-${BATCH_TS}.json"

if [[ -f "$RESULTS_FILE" ]]; then
  python3 -c "
import json, os
from datetime import datetime, timezone

editions_data = []
root = '$ROOT_DIR'
stage_map = {10: 'ocr', 20: 'cleanup', 30: 'upload', 40: 'seed'}

with open('$RESULTS_FILE') as rf:
    for line in rf:
        line = line.strip()
        if not line:
            continue
        date, code_str = line.rsplit(':', 1)
        code = int(code_str)
        failed_stage = stage_map.get(code) if code != 0 else None

        summary_path = os.path.join(root, 'ocr', 'runs', date, 'pipeline-summary.json')
        article_count = 0
        ad_count = 0
        stages = []
        total_seconds = 0
        if os.path.exists(summary_path):
            with open(summary_path) as f:
                s = json.load(f)
            article_count = s.get('article_count', 0)
            ad_count = s.get('ad_count', 0)
            stages = s.get('stages', [])
            total_seconds = s.get('total_seconds', 0)

        editions_data.append({
            'date': date,
            'success': code == 0,
            'exit_code': code,
            'failed_stage': failed_stage,
            'article_count': article_count,
            'ad_count': ad_count,
            'total_seconds': total_seconds,
            'stages': stages,
        })

editions_data.sort(key=lambda x: x['date'])

report = {
    'batch_timestamp': datetime.now(timezone.utc).isoformat(),
    'total': $TOTAL,
    'successes': $SUCCESSES,
    'failures': $FAILURES,
    'elapsed_seconds': $ELAPSED,
    'editions': editions_data,
}

with open('$BATCH_REPORT', 'w') as f:
    json.dump(report, f, indent=2)
print('Batch report: $BATCH_REPORT')
" 2>/dev/null || echo "Warning: Could not write batch report"
fi

# Clean up temp results file
rm -f "$RESULTS_FILE"

[[ "$FAILURES" -eq 0 ]]
