#!/usr/bin/env bash
set -euo pipefail

# Small production-path audit. Results are printed only to stdout.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd -P)"
PROCESS_SCRIPT="$ROOT_DIR/scripts/ocr/process-edition.sh"
INPUTS=(
  "$ROOT_DIR/ocr/inbox/1988-10-12"
  "$ROOT_DIR/ocr/inbox/1992-05-01"
)

START_SECONDS=$SECONDS
FAILURES=0

echo "OCR pipeline audit: ${#INPUTS[@]} editions"
for input in "${INPUTS[@]}"; do
  label="$(basename "$input")"
  item_start=$SECONDS
  exit_code=0
  bash "$PROCESS_SCRIPT" "$input" || exit_code=$?
  item_elapsed=$((SECONDS - item_start))
  if [[ $exit_code -eq 0 ]]; then
    echo "$label completed in ${item_elapsed}s"
  else
    FAILURES=$((FAILURES + 1))
    echo "$label failed with exit $exit_code after ${item_elapsed}s"
  fi
done

TOTAL_ELAPSED=$((SECONDS - START_SECONDS))
echo "Audit complete in ${TOTAL_ELAPSED}s with $FAILURES failure(s)."
[[ $FAILURES -eq 0 ]]
