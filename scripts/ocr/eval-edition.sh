#!/usr/bin/env bash
set -euo pipefail

# OCR-only run of one inbox edition, scored against gold/<date>/ when it exists.
# Never uploads assets, seeds the database, promotes an edition or removes scans.
#
#   scripts/ocr/eval-edition.sh YYYY-MM-DD
#
# Claude reads the page text itself. work/ keeps each page's OCR image, the strips
# Claude read and its transcription.
#
# Writes ocr/runs/eval/<date>/<UTC time>-<commit>-claude/: the candidate edition,
# run.log, score.md (+ score.json) and diff.md.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd -P)"
DATE="${1:-}"
[[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "usage: $0 YYYY-MM-DD" >&2; exit 2; }

shopt -s nullglob
sources=("$ROOT_DIR/ocr/inbox/$DATE"*/)
shopt -u nullglob
[[ ${#sources[@]} -eq 1 ]] || {
  echo "need exactly one ocr/inbox/$DATE* folder, found ${#sources[@]}" >&2
  exit 2
}
SOURCE_DIR="${sources[0]%/}"

# Load simple KEY=VALUE entries without evaluating shell code.
if [[ -f "$ROOT_DIR/.env.local" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key//[[:space:]]/}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    export "$key=$value"
  done < "$ROOT_DIR/.env.local"
fi

COMMIT="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
[[ -z "$(git -C "$ROOT_DIR" status --porcelain -- ocr/src)" ]] || COMMIT="$COMMIT-dirty"
RUN_DIR="$ROOT_DIR/ocr/runs/eval/$DATE/$(date -u +%Y%m%dT%H%M%SZ)-$COMMIT-claude"
mkdir -p "$RUN_DIR"

export OCR_ENVIRONMENT=production
export OCR_SAVE_PAGE_TEXT=1
export YOLO_CONFIG_DIR="$RUN_DIR/yolo"
export MPLCONFIGDIR="$RUN_DIR/matplotlib"

# shellcheck disable=SC1091
source "$ROOT_DIR/ocr/.venv/bin/activate"

START_SECONDS=$SECONDS
python "$ROOT_DIR/ocr/convert_scans.py" "$SOURCE_DIR" \
  --output-root "$RUN_DIR/out" \
  --work-root "$RUN_DIR/work" 2>&1 | tee "$RUN_DIR/run.log"

CANDIDATE="$RUN_DIR/out/$DATE/edition.json"
python "$ROOT_DIR/ocr/validate_candidate.py" "$CANDIDATE" --date "$DATE"

GOLD="$ROOT_DIR/gold/$DATE/gold-edition.json"
if [[ -f "$GOLD" ]]; then
  python "$ROOT_DIR/ocr/score_gold.py" \
    --gold-edition "$GOLD" \
    --candidate-edition "$CANDIDATE" \
    --auto-map \
    --output-json "$RUN_DIR/score.json" \
    --output-md "$RUN_DIR/score.md" \
    --output-diff "$RUN_DIR/diff.md"
  cat "$RUN_DIR/score.md"
else
  echo "No gold/$DATE/gold-edition.json: the candidate is validated but not scored."
fi
echo "Run: $RUN_DIR ($((SECONDS - START_SECONDS))s)"
