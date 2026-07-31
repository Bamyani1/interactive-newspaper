#!/usr/bin/env bash
set -euo pipefail

# Discover edition directories and invoke the transactional edition publisher.
# All progress and the final batch summary are stdout-only.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd -P)"
INBOX_DIR="$ROOT_DIR/ocr/inbox"
PROCESS_SCRIPT="$ROOT_DIR/scripts/ocr/process-edition.sh"

PARALLEL=1
DRY_RUN=false
WORKERS=""
SEED=false

usage() {
  cat <<'EOF'
Usage: scripts/ocr/process-unprocessed.sh [options]
  --parallel N   Number of editions processed concurrently (default 1)
  --workers N    Page workers passed to each edition
  --inbox DIR    Alternate discovery directory
  --seed         Seed the database after each successful publication
  --dry-run      List editions without processing
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --parallel)
      [[ $# -ge 2 ]] || { echo "ERROR: --parallel requires a positive integer" >&2; exit 2; }
      PARALLEL="$2"
      shift 2
      ;;
    --workers)
      [[ $# -ge 2 ]] || { echo "ERROR: --workers requires a positive integer" >&2; exit 2; }
      WORKERS="$2"
      shift 2
      ;;
    --inbox)
      [[ $# -ge 2 ]] || { echo "ERROR: --inbox requires a directory" >&2; exit 2; }
      INBOX_DIR="$2"
      shift 2
      ;;
    --seed)
      SEED=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -*)
      usage >&2
      echo "ERROR: unknown option: $1" >&2
      exit 2
      ;;
    *)
      usage >&2
      echo "ERROR: unexpected argument: $1" >&2
      exit 2
      ;;
  esac
done

[[ "$PARALLEL" =~ ^[1-9][0-9]*$ ]] || { echo "ERROR: --parallel must be a positive integer" >&2; exit 2; }
if [[ -n "$WORKERS" && ! "$WORKERS" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: --workers must be a positive integer" >&2
  exit 2
fi

if [[ ! -d "$INBOX_DIR" ]]; then
  echo "No edition directory found at: $INBOX_DIR"
  exit 0
fi

EDITIONS=()
while IFS= read -r edition; do
  EDITIONS+=("$edition")
done < <(find "$INBOX_DIR" -mindepth 1 -maxdepth 1 -type d | sort)

if [[ ${#EDITIONS[@]} -eq 0 ]]; then
  echo "No editions found in $INBOX_DIR"
  exit 0
fi

edition_label() {
  local name
  name="$(basename "$1")"
  if [[ "$name" =~ ([0-9]{4}-[0-9]{2}-[0-9]{2}) ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  else
    printf '%s' "$name"
  fi
}

decode_stage() {
  case "$1" in
    10) echo "ocr" ;;
    20) echo "validation" ;;
    30) echo "upload" ;;
    40) echo "promotion" ;;
    50) echo "seed" ;;
    75) echo "lock" ;;
    *) echo "exit-$1" ;;
  esac
}

echo "Found ${#EDITIONS[@]} edition(s):"
for edition in "${EDITIONS[@]}"; do
  label="$(edition_label "$edition")"
  page_count="$(find "$edition" -maxdepth 1 -type f \( -iname '*.tif' -o -iname '*.tiff' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) | wc -l | tr -d ' ')"
  echo "  - $label ($page_count local image files)"
done

if [[ "$DRY_RUN" == "true" ]]; then
  echo "Dry run complete; no editions were processed."
  exit 0
fi

START_SECONDS=$SECONDS
SUCCESSES=0
FAILURES=0
FAILED_LABELS=()

if [[ "$PARALLEL" -eq 1 ]]; then
  for edition in "${EDITIONS[@]}"; do
    label="$(edition_label "$edition")"
    args=()
    [[ -n "$WORKERS" ]] && args+=(--workers "$WORKERS")
    [[ "$SEED" == "true" ]] && args+=(--seed)
    echo "Starting $label"
    exit_code=0
    bash "$PROCESS_SCRIPT" "$edition" "${args[@]}" || exit_code=$?
    if [[ $exit_code -eq 0 ]]; then
      SUCCESSES=$((SUCCESSES + 1))
    else
      FAILURES=$((FAILURES + 1))
      FAILED_LABELS+=("$label:$exit_code")
      echo "Failed $label at $(decode_stage "$exit_code")"
    fi
  done
else
  BATCH_TMP_ROOT="${TMPDIR:-/tmp}"
  BATCH_TMP_ROOT="${BATCH_TMP_ROOT%/}"
  RESULTS_DIR="$(mktemp -d "$BATCH_TMP_ROOT/ocr-batch.XXXXXX")"
  cleanup_results() {
    if [[ -n "${RESULTS_DIR:-}" && -d "$RESULTS_DIR" && "$RESULTS_DIR" == "$BATCH_TMP_ROOT"/* ]]; then
      rm -rf -- "$RESULTS_DIR"
    fi
  }
  trap cleanup_results EXIT
  trap 'cleanup_results; exit 130' INT TERM HUP

  process_one() {
    local edition="$1"
    local name label result_file exit_code
    local args=()
    name="$(basename "$edition")"
    if [[ "$name" =~ ([0-9]{4}-[0-9]{2}-[0-9]{2}) ]]; then
      label="${BASH_REMATCH[1]}"
    else
      label="$name"
    fi
    [[ -n "$BATCH_WORKERS" ]] && args+=(--workers "$BATCH_WORKERS")
    [[ "$BATCH_SEED" == "true" ]] && args+=(--seed)
    echo "Starting $label"
    exit_code=0
    bash "$PROCESS_SCRIPT" "$edition" "${args[@]}" || exit_code=$?
    result_file="$(mktemp "$BATCH_RESULTS/result.XXXXXX")"
    printf '%s\t%s\n' "$label" "$exit_code" > "$result_file"
  }
  export -f process_one
  export PROCESS_SCRIPT RESULTS_DIR
  export BATCH_RESULTS="$RESULTS_DIR"
  export BATCH_WORKERS="$WORKERS"
  export BATCH_SEED="$SEED"

  set +e
  printf '%s\n' "${EDITIONS[@]}" | xargs -P "$PARALLEL" -I {} bash -c 'process_one "$1"' _ {}
  set -e

  for result_file in "$RESULTS_DIR"/result.*; do
    [[ -f "$result_file" ]] || continue
    IFS=$'\t' read -r label exit_code < "$result_file"
    if [[ "$exit_code" -eq 0 ]]; then
      SUCCESSES=$((SUCCESSES + 1))
    else
      FAILURES=$((FAILURES + 1))
      FAILED_LABELS+=("$label:$exit_code")
    fi
  done
  cleanup_results
  trap - EXIT INT TERM HUP
fi

ELAPSED=$((SECONDS - START_SECONDS))
echo "Batch complete in ${ELAPSED}s: $SUCCESSES succeeded, $FAILURES failed."
if [[ $FAILURES -gt 0 ]]; then
  for failure in "${FAILED_LABELS[@]}"; do
    label="${failure%%:*}"
    exit_code="${failure##*:}"
    echo "  - $label ($(decode_stage "$exit_code"))"
  done
  exit 1
fi
