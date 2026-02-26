#!/bin/bash
set -euo pipefail

# ── process-edition.sh ──────────────────────────────────────────
# Processes a single newspaper edition through the full pipeline:
#   OCR (with ad enrichment) → image cleanup → seed
#
# Usage:
#   scripts/process-edition.sh <path-to-edition-scan-dir> [--run-id <id>] [--keep-source] [--cleanup-date YYYY-MM-DD] [--workers N]
#
# Example:
#   scripts/process-edition.sh "ocr/inbox/1970-01-14 The Ohio Wesleyan Transcript Delaware OH 1970-01-14" --run-id baseline-1970-01-14
#
# The scan directory must contain numbered TIF files (e.g., 0001_Page 1.tif).
# On success, the directory is moved to ocr/done/.
# ────────────────────────────────────────────────────────────────

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

# ── Args ────────────────────────────────────────────────────────

EDITION_PATH=""
RUN_ID=""
KEEP_SOURCE=false
CLEANUP_DATE=""
PUBLIC_OUTPUT_ROOT=""
OCR_OUTPUT_ROOT=""
WORKERS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id)
      RUN_ID="${2:-}"
      if [[ -z "$RUN_ID" ]]; then
        echo "ERROR: --run-id requires a value"
        exit 1
      fi
      shift 2
      ;;
    --keep-source)
      KEEP_SOURCE=true
      shift
      ;;
    --cleanup-date)
      CLEANUP_DATE="${2:-}"
      if [[ -z "$CLEANUP_DATE" ]]; then
        echo "ERROR: --cleanup-date requires a YYYY-MM-DD value"
        exit 1
      fi
      shift 2
      ;;
    --public-output-root)
      PUBLIC_OUTPUT_ROOT="${2:-}"
      if [[ -z "$PUBLIC_OUTPUT_ROOT" ]]; then
        echo "ERROR: --public-output-root requires a path"
        exit 1
      fi
      shift 2
      ;;
    --ocr-output-root)
      OCR_OUTPUT_ROOT="${2:-}"
      if [[ -z "$OCR_OUTPUT_ROOT" ]]; then
        echo "ERROR: --ocr-output-root requires a path"
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
    -*)
      echo "ERROR: Unknown option: $1"
      echo "Usage: scripts/process-edition.sh <path-to-edition-scan-dir> [--run-id <id>] [--keep-source] [--cleanup-date YYYY-MM-DD]"
      exit 1
      ;;
    *)
      if [[ -n "$EDITION_PATH" ]]; then
        echo "ERROR: Multiple edition paths provided: '$EDITION_PATH' and '$1'"
        exit 1
      fi
      EDITION_PATH="$1"
      shift
      ;;
  esac
done

if [[ -z "$EDITION_PATH" ]]; then
  echo "Usage: scripts/process-edition.sh <path-to-edition-scan-dir> [--run-id <id>] [--keep-source] [--cleanup-date YYYY-MM-DD]"
  exit 1
fi

if [[ ! -d "$EDITION_PATH" ]]; then
  echo "ERROR: Directory not found: $EDITION_PATH"
  exit 1
fi

# Extract YYYY-MM-DD date from directory name
DATE=$(echo "$(basename "$EDITION_PATH")" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)
if [[ -z "$DATE" ]]; then
  echo "ERROR: Could not extract date from directory name: $(basename "$EDITION_PATH")"
  exit 1
fi

echo "════════════════════════════════════════════════════════════════"
echo "Processing edition: $DATE"
echo "Source: $EDITION_PATH"
if [[ -n "$RUN_ID" ]]; then
  echo "Run ID: $RUN_ID"
fi
echo "════════════════════════════════════════════════════════════════"

# ── Environment ─────────────────────────────────────────────────

if [[ -f "$ROOT_DIR/.env.local" ]]; then
  while IFS='=' read -r key value; do
    # Skip comments and blank lines
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    # Strip surrounding quotes if present
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    export "$key=$value"
  done < "$ROOT_DIR/.env.local"
fi

if [[ -z "${GOOGLE_API_KEY:-}" ]]; then
  echo "ERROR: GOOGLE_API_KEY not set. Add it to .env.local or export it."
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL not set. Add it to .env.local or export it."
  exit 1
fi

# Activate Python venv
if [[ -f "$ROOT_DIR/ocr/.venv/bin/activate" ]]; then
  source "$ROOT_DIR/ocr/.venv/bin/activate"
else
  echo "ERROR: Python venv not found at ocr/.venv/"
  exit 1
fi

# ── Logging ─────────────────────────────────────────────────────

if [[ -n "$RUN_ID" ]]; then
  LOG_DIR="$ROOT_DIR/ocr/runs/$DATE/runs/$RUN_ID"
else
  LOG_DIR="$ROOT_DIR/ocr/runs/$DATE"
fi
mkdir -p "$LOG_DIR"
if [[ -z "$CLEANUP_DATE" ]]; then
  CLEANUP_DATE="$DATE"
fi

# ── Stage 1: OCR (includes ad enrichment) ─────────────────────

echo ""
echo "── Stage 1/4: OCR extraction + ad enrichment ────────────────"
OCR_CMD=(python "$ROOT_DIR/ocr/convert_scans.py" "$EDITION_PATH")
if [[ -n "$RUN_ID" ]]; then
  OCR_CMD+=(--run-id "$RUN_ID")
fi
if [[ -n "$OCR_OUTPUT_ROOT" ]]; then
  OCR_CMD+=(--ocr-output-root "$OCR_OUTPUT_ROOT")
fi
if [[ -n "$PUBLIC_OUTPUT_ROOT" ]]; then
  OCR_CMD+=(--public-output-root "$PUBLIC_OUTPUT_ROOT")
fi
if [[ -n "$WORKERS" ]]; then
  OCR_CMD+=(--workers "$WORKERS")
fi
"${OCR_CMD[@]}" 2>&1 | tee "$LOG_DIR/ocr.log"

# Validate OCR output
PUBLIC_ROOT="${PUBLIC_OUTPUT_ROOT:-$ROOT_DIR/public/editions}"
EDITION_JSON="$PUBLIC_ROOT/$DATE/edition.json"
if [[ ! -f "$EDITION_JSON" ]]; then
  echo "FAILED: edition.json not created at $EDITION_JSON"
  exit 1
fi

ARTICLE_COUNT=$(python3 -c "
import json, sys
with open('$EDITION_JSON') as f:
    d = json.load(f)
print(len(d.get('articles', [])))
")

if [[ "$ARTICLE_COUNT" -lt 1 ]]; then
  echo "FAILED: No articles found in edition.json"
  exit 1
fi

echo "  ✓ OCR complete: $ARTICLE_COUNT articles extracted (ad enrichment included)"

# ── Stage 2: Image cleanup ─────────────────────────────────────

echo ""
echo "── Stage 2/4: Image cleanup ───────────────────────────────"
node "$ROOT_DIR/scripts/cleanup-images.mjs" \
  --apply \
  --date "$CLEANUP_DATE" \
  --editions-dir "$PUBLIC_ROOT" \
  --report-path "$LOG_DIR/cleanup-report.json" \
  2>&1 | tee "$LOG_DIR/cleanup-images.log"
echo "  ✓ Image cleanup applied"

# ── Stage 3: Upload images to R2 ──────────────────────────────

echo ""
echo "── Stage 3/4: Upload images to R2 ────────────────────────"
if [[ -n "${R2_ACCOUNT_ID:-}" && -n "${R2_BUCKET_NAME:-}" ]]; then
  node "$ROOT_DIR/scripts/db/upload-images.mjs" \
    --date "$DATE" \
    --editions-dir "$PUBLIC_ROOT" \
    2>&1 | tee "$LOG_DIR/upload-images.log"
  echo "  ✓ Images uploaded to R2"
else
  echo "  ⊘ Skipped (R2 credentials not configured)"
fi

# ── Stage 4: Database seed + embed ─────────────────────────────

echo ""
echo "── Stage 4/4: Database seed ───────────────────────────────"
OCR_MIN_TEXT_LENGTH=0 npm run db:seed -- --date "$DATE" --editions-dir "$PUBLIC_ROOT" --summary-path "$LOG_DIR/seed-summary.json" 2>&1 | tee "$LOG_DIR/seed.log"
echo "  ✓ Database seeded"

# ── Move to processed ──────────────────────────────────────────

PROCESSED_DIR="$ROOT_DIR/ocr/done"
mkdir -p "$PROCESSED_DIR"
if [[ "$KEEP_SOURCE" == "false" && -d "$EDITION_PATH" ]]; then
  mv "$EDITION_PATH" "$PROCESSED_DIR/" || echo "Warning: Could not move scan directory"
elif [[ "$KEEP_SOURCE" == "true" ]]; then
  echo "Info: --keep-source enabled; leaving scans in place"
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
AD_COUNT=$(python3 -c "
import json
with open('$EDITION_JSON') as f:
    d = json.load(f)
print(len(d.get('ads', [])))
")
echo "✓ Edition $DATE processed successfully"
echo "  Articles: $ARTICLE_COUNT  |  Ads: $AD_COUNT"
if [[ "$KEEP_SOURCE" == "false" ]]; then
  echo "  Scan moved to: ocr/done/"
else
  echo "  Scan preserved in source path"
fi
echo "  Logs: $LOG_DIR/"
echo "════════════════════════════════════════════════════════════════"
