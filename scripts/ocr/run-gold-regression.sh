#!/usr/bin/env bash
set -euo pipefail

# Extraction-only regression against the frozen 1990-02-21 source set.
# This command never uploads assets, seeds the database, or promotes an edition.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd -P)"
SOURCE_DIR="$ROOT_DIR/ocr/inbox/1990-02-21 The Transcript Delaware OH 1990-02-21"
MANIFEST="$ROOT_DIR/gold-candidates/1990-02-21/source/manifest.json"
OUTPUT_ROOT="${1:-/private/tmp/ocr-gold-regression-final/candidates}"
DATE="1990-02-21"

[[ -d "$SOURCE_DIR" ]] || { echo "Missing frozen source pages: $SOURCE_DIR" >&2; exit 2; }
[[ -f "$MANIFEST" ]] || { echo "Missing frozen source manifest: $MANIFEST" >&2; exit 2; }
[[ ! -e "$OUTPUT_ROOT/$DATE" ]] || {
  echo "Refusing to overwrite existing regression candidate: $OUTPUT_ROOT/$DATE" >&2
  exit 2
}

mkdir -p "$OUTPUT_ROOT"
WORK_ROOT="$(mktemp -d /private/tmp/ocr-gold-work.XXXXXX)"
cleanup() {
  case "$WORK_ROOT" in
    /private/tmp/ocr-gold-work.*) rm -rf -- "$WORK_ROOT" ;;
  esac
}
trap cleanup EXIT INT TERM HUP

export PYTHONPATH="$ROOT_DIR/ocr/src"
export MPLCONFIGDIR="$WORK_ROOT/matplotlib"
export YOLO_CONFIG_DIR="$WORK_ROOT/ultralytics"
export OCR_ENVIRONMENT=development
export GOOGLE_CLOUD_LOCATION=global
mkdir -p "$MPLCONFIGDIR" "$YOLO_CONFIG_DIR"

"$ROOT_DIR/ocr/.venv/bin/dotenv" -f "$ROOT_DIR/.env.local" run -- \
  "$ROOT_DIR/ocr/.venv/bin/python" "$ROOT_DIR/ocr/convert_scans.py" \
  "$SOURCE_DIR" \
  --manifest "$MANIFEST" \
  --output-root "$OUTPUT_ROOT" \
  --work-root "$WORK_ROOT" \
  --workers 1
