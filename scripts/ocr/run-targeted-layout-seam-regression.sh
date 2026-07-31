#!/usr/bin/env bash
set -euo pipefail

# Targeted production-path regression for the Wing Nite seam (pages 5-6) and
# paragraph reading-order cases (pages 7-8). It never uploads, seeds, or promotes.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd -P)"
SOURCE_DIR="$ROOT_DIR/ocr/inbox/1990-02-21 The Transcript Delaware OH 1990-02-21"
OUTPUT_ROOT="${1:-/private/tmp/ocr-layout-seam-regression/candidates}"
DATE="1990-02-21"

[[ -d "$SOURCE_DIR" ]] || { echo "Missing source pages: $SOURCE_DIR" >&2; exit 2; }
[[ ! -e "$OUTPUT_ROOT/$DATE" ]] || {
  echo "Refusing to overwrite targeted candidate: $OUTPUT_ROOT/$DATE" >&2
  exit 2
}

INPUT_ROOT="$(mktemp -d /private/tmp/ocr-layout-seam-input.XXXXXX)"
EDITION_DIR="$INPUT_ROOT/1990-02-21 targeted layout and seam"
WORK_ROOT="$(mktemp -d /private/tmp/ocr-layout-seam-work.XXXXXX)"
cleanup() {
  case "$INPUT_ROOT" in
    /private/tmp/ocr-layout-seam-input.*) rm -rf -- "$INPUT_ROOT" ;;
  esac
  case "$WORK_ROOT" in
    /private/tmp/ocr-layout-seam-work.*) rm -rf -- "$WORK_ROOT" ;;
  esac
}
trap cleanup EXIT INT TERM HUP

mkdir -p "$EDITION_DIR" "$OUTPUT_ROOT"
cp "$SOURCE_DIR/0005_Page 5.jpg" "$EDITION_DIR/"
cp "$SOURCE_DIR/0006_Page 6.jpg" "$EDITION_DIR/"
cp "$SOURCE_DIR/0007_Page 7.jpg" "$EDITION_DIR/"
cp "$SOURCE_DIR/0008_Page 8.jpg" "$EDITION_DIR/"

if [[ "${2:-all}" == "layout-only" ]]; then
  rm -f -- "$EDITION_DIR/0005_Page 5.jpg" "$EDITION_DIR/0006_Page 6.jpg"
elif [[ "${2:-all}" != "all" ]]; then
  echo "Unknown target set: ${2:-}" >&2
  exit 2
fi

export PYTHONPATH="$ROOT_DIR/ocr/src"
export MPLCONFIGDIR="$WORK_ROOT/matplotlib"
export YOLO_CONFIG_DIR="$WORK_ROOT/ultralytics"
export OCR_ENVIRONMENT=development
export GOOGLE_CLOUD_LOCATION=global
mkdir -p "$MPLCONFIGDIR" "$YOLO_CONFIG_DIR"

"$ROOT_DIR/ocr/.venv/bin/dotenv" -f "$ROOT_DIR/.env.local" run -- \
  "$ROOT_DIR/ocr/.venv/bin/python" "$ROOT_DIR/ocr/convert_scans.py" \
  "$EDITION_DIR" \
  --output-root "$OUTPUT_ROOT" \
  --work-root "$WORK_ROOT" \
  --workers 1
