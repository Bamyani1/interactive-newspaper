#!/bin/bash
set -euo pipefail

# ── process-edition.sh ──────────────────────────────────────────
# Processes a single newspaper edition through the full pipeline:
#   OCR (with ad enrichment) → image cleanup → R2 upload → DB seed (with embedding)
#
# Usage:
#   scripts/ocr/process-edition.sh <path-to-edition-scan-dir> [options]
#
# Options:
#   --run-id <id>             Custom run identifier for versioning
#   --keep-source             Don't move scan dir to ocr/done/ after processing
#   --cleanup-date YYYY-MM-DD Override the cleanup date (defaults to edition date)
#   --workers N               Number of OCR workers
#   --from-stage N            Resume from stage N (1=OCR, 2=cleanup, 3=upload, 4=seed)
#
# Example:
#   scripts/ocr/process-edition.sh "ocr/inbox/1970-01-14 ..." --run-id baseline-1970-01-14
#   scripts/ocr/process-edition.sh "ocr/inbox/1970-01-14 ..." --from-stage 4  # re-seed only
#
# The scan directory must contain numbered TIF files (e.g., 0001_Page 1.tif).
# On success, the directory is moved to ocr/done/.
#
# Exit codes: 0=success, 10=OCR failed, 20=cleanup failed, 30=upload failed, 40=seed failed
# ────────────────────────────────────────────────────────────────

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

# ── Args ────────────────────────────────────────────────────────

EDITION_PATH=""
RUN_ID=""
KEEP_SOURCE=false
CLEANUP_DATE=""
WORKERS=""
FROM_STAGE=1

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
    --workers)
      WORKERS="${2:-}"
      if [[ -z "$WORKERS" ]]; then
        echo "ERROR: --workers requires a number"
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
    -*)
      echo "ERROR: Unknown option: $1"
      echo "Usage: scripts/ocr/process-edition.sh <path> [--run-id <id>] [--keep-source] [--cleanup-date YYYY-MM-DD] [--workers N] [--from-stage N]"
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
  echo "Usage: scripts/ocr/process-edition.sh <path> [--run-id <id>] [--keep-source] [--cleanup-date YYYY-MM-DD] [--workers N] [--from-stage N]"
  exit 1
fi

# When resuming from stage 2+, the scan directory may already be in ocr/done/
if [[ "$FROM_STAGE" -eq 1 && ! -d "$EDITION_PATH" ]]; then
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
if [[ "$FROM_STAGE" -gt 1 ]]; then
  echo "Resuming from stage $FROM_STAGE (stages 1-$((FROM_STAGE - 1)) skipped)"
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

# ── Logging & paths ────────────────────────────────────────────

if [[ -n "$RUN_ID" ]]; then
  LOG_DIR="$ROOT_DIR/ocr/runs/$DATE/runs/$RUN_ID"
else
  LOG_DIR="$ROOT_DIR/ocr/runs/$DATE"
fi
mkdir -p "$LOG_DIR"

if [[ -z "$CLEANUP_DATE" ]]; then
  CLEANUP_DATE="$DATE"
fi

PUBLIC_ROOT="$ROOT_DIR/public/editions"
EDITION_JSON="$PUBLIC_ROOT/$DATE/edition.json"

# ── Timing & summary infrastructure ───────────────────────────

PIPELINE_START=$(date +%s)
FAILED_STAGE=""

# Stage timing — defaults so the trap always has valid values
S1_STATUS="skipped"; S1_ELAPSED=0
S2_STATUS="skipped"; S2_ELAPSED=0
S3_STATUS="skipped"; S3_ELAPSED=0
S4_STATUS="skipped"; S4_ELAPSED=0

on_exit() {
  local exit_code=$?

  # Guard: skip summary if we exited before key variables were set
  if [[ -z "${LOG_DIR:-}" || -z "${DATE:-}" ]]; then
    return
  fi

  local pipeline_end
  pipeline_end=$(date +%s)
  local total=$(( pipeline_end - ${PIPELINE_START:-$pipeline_end} ))

  # Best-effort article/ad counts
  local art=0 ads=0
  if [[ -f "${EDITION_JSON:-}" ]]; then
    art=$(python -c "
import json
with open('${EDITION_JSON}') as f:
    print(len(json.load(f).get('articles',[])))
" 2>/dev/null) || art=0
    ads=$(python -c "
import json
with open('${EDITION_JSON}') as f:
    print(len(json.load(f).get('ads',[])))
" 2>/dev/null) || ads=0
  fi

  python -c "
import json
stages = [
    {'name':'ocr',     'status':'${S1_STATUS:-skipped}', 'elapsed_seconds':${S1_ELAPSED:-0}},
    {'name':'cleanup', 'status':'${S2_STATUS:-skipped}', 'elapsed_seconds':${S2_ELAPSED:-0}},
    {'name':'upload',  'status':'${S3_STATUS:-skipped}', 'elapsed_seconds':${S3_ELAPSED:-0}},
    {'name':'seed',    'status':'${S4_STATUS:-skipped}', 'elapsed_seconds':${S4_ELAPSED:-0}},
]
report = {
    'date': '${DATE}',
    'success': ${exit_code} == 0,
    'failed_stage': '${FAILED_STAGE:-}' or None,
    'exit_code': ${exit_code},
    'stages': stages,
    'total_seconds': ${total},
    'article_count': ${art},
    'ad_count': ${ads},
}
with open('${LOG_DIR}/pipeline-summary.json', 'w') as f:
    json.dump(report, f, indent=2)
" 2>/dev/null || true
}
trap on_exit EXIT

# Validate edition.json exists (used when resuming from stage 2+)
validate_edition_json() {
  if [[ ! -f "$EDITION_JSON" ]]; then
    echo "ERROR: --from-stage $FROM_STAGE requires edition.json at $EDITION_JSON"
    echo "       Run from stage 1 first to generate it."
    exit 1
  fi
  ARTICLE_COUNT=$(python -c "
import json
with open('$EDITION_JSON') as f:
    print(len(json.load(f).get('articles',[])))
")
  if [[ "$ARTICLE_COUNT" -lt 1 ]]; then
    echo "ERROR: edition.json has no articles"
    exit 1
  fi
  echo "  ✓ edition.json validated: $ARTICLE_COUNT articles"
}

# ── Stage 1: OCR (includes ad enrichment) ─────────────────────

if [[ "$FROM_STAGE" -le 1 ]]; then
  echo ""
  echo "── Stage 1/4: OCR extraction + ad enrichment ────────────────"
  S1_START=$(date +%s)
  S1_STATUS="failed"

  OCR_CMD=(python "$ROOT_DIR/ocr/convert_scans.py" "$EDITION_PATH")
  if [[ -n "$RUN_ID" ]]; then
    OCR_CMD+=(--run-id "$RUN_ID")
  fi
  if [[ -n "$WORKERS" ]]; then
    OCR_CMD+=(--workers "$WORKERS")
  fi

  set +e
  "${OCR_CMD[@]}" 2>&1 | tee "$LOG_DIR/ocr.log"
  OCR_EXIT=${PIPESTATUS[0]}
  set -e

  S1_ELAPSED=$(( $(date +%s) - S1_START ))

  if [[ $OCR_EXIT -ne 0 ]]; then
    echo "FAILED: OCR exited with code $OCR_EXIT"
    FAILED_STAGE="ocr"; exit 10
  fi

  # Validate OCR output
  if [[ ! -f "$EDITION_JSON" ]]; then
    echo "FAILED: edition.json not created at $EDITION_JSON"
    FAILED_STAGE="ocr"; exit 10
  fi

  ARTICLE_COUNT=$(python -c "
import json
with open('$EDITION_JSON') as f:
    print(len(json.load(f).get('articles',[])))
")

  if [[ "$ARTICLE_COUNT" -lt 1 ]]; then
    echo "FAILED: No articles found in edition.json"
    FAILED_STAGE="ocr"; exit 10
  fi

  S1_STATUS="success"
  echo "  ✓ OCR complete: $ARTICLE_COUNT articles extracted (${S1_ELAPSED}s)"
else
  echo ""
  echo "── Stage 1/4: OCR skipped (--from-stage $FROM_STAGE) ───────────"
  validate_edition_json
fi

# ── Stage 2: Image cleanup ─────────────────────────────────────

if [[ "$FROM_STAGE" -le 2 ]]; then
  echo ""
  echo "── Stage 2/4: Image cleanup ───────────────────────────────"
  S2_START=$(date +%s)
  S2_STATUS="failed"

  set +e
  node "$ROOT_DIR/scripts/cleanup-images.mjs" \
    --apply \
    --date "$CLEANUP_DATE" \
    --editions-dir "$PUBLIC_ROOT" \
    --report-path "$LOG_DIR/cleanup-report.json" \
    2>&1 | tee "$LOG_DIR/cleanup-images.log"
  CLEANUP_EXIT=${PIPESTATUS[0]}
  set -e

  S2_ELAPSED=$(( $(date +%s) - S2_START ))

  if [[ $CLEANUP_EXIT -ne 0 ]]; then
    echo "FAILED: Image cleanup exited with code $CLEANUP_EXIT"
    FAILED_STAGE="cleanup"; exit 20
  fi

  S2_STATUS="success"
  echo "  ✓ Image cleanup applied (${S2_ELAPSED}s)"
else
  echo ""
  echo "── Stage 2/4: Image cleanup skipped (--from-stage $FROM_STAGE) ─"
fi

# ── Stage 3: Upload images to R2 ──────────────────────────────

if [[ "$FROM_STAGE" -le 3 ]]; then
  echo ""
  echo "── Stage 3/4: Upload images to R2 ────────────────────────"
  if [[ -n "${R2_ACCOUNT_ID:-}" && -n "${R2_BUCKET_NAME:-}" ]]; then
    S3_START=$(date +%s)
    S3_STATUS="failed"

    set +e
    node "$ROOT_DIR/scripts/db/upload-images.mjs" \
      --date "$DATE" \
      --editions-dir "$PUBLIC_ROOT" \
      2>&1 | tee "$LOG_DIR/upload-images.log"
    UPLOAD_EXIT=${PIPESTATUS[0]}
    set -e

    S3_ELAPSED=$(( $(date +%s) - S3_START ))

    if [[ $UPLOAD_EXIT -ne 0 ]]; then
      echo "FAILED: Image upload exited with code $UPLOAD_EXIT"
      FAILED_STAGE="upload"; exit 30
    fi

    S3_STATUS="success"
    echo "  ✓ Images uploaded to R2 (${S3_ELAPSED}s)"
  else
    S3_STATUS="skipped"
    echo "  ⊘ Skipped (R2 credentials not configured)"
  fi
else
  echo ""
  echo "── Stage 3/4: R2 upload skipped (--from-stage $FROM_STAGE) ─────"
fi

# ── Stage 4: Database seed + embed ─────────────────────────────

echo ""
echo "── Stage 4/4: Database seed ───────────────────────────────"
S4_START=$(date +%s)
S4_STATUS="failed"

set +e
OCR_MIN_TEXT_LENGTH=0 npm run db:seed -- \
  --date "$DATE" \
  --editions-dir "$PUBLIC_ROOT" \
  --summary-path "$LOG_DIR/seed-summary.json" \
  2>&1 | tee "$LOG_DIR/seed.log"
SEED_EXIT=${PIPESTATUS[0]}
set -e

S4_ELAPSED=$(( $(date +%s) - S4_START ))

if [[ $SEED_EXIT -ne 0 ]]; then
  echo "FAILED: Database seed exited with code $SEED_EXIT"
  FAILED_STAGE="seed"; exit 40
fi

S4_STATUS="success"
echo "  ✓ Database seeded (${S4_ELAPSED}s)"

# ── Move to processed ──────────────────────────────────────────

PROCESSED_DIR="$ROOT_DIR/ocr/done"
mkdir -p "$PROCESSED_DIR"
if [[ "$KEEP_SOURCE" == "false" ]]; then
  if [[ -d "$EDITION_PATH" ]]; then
    mv "$EDITION_PATH" "$PROCESSED_DIR/" || echo "Warning: Could not move scan directory"
  elif [[ "$FROM_STAGE" -gt 1 ]]; then
    echo "Info: Scan directory not present (already moved on prior run)"
  fi
elif [[ "$KEEP_SOURCE" == "true" ]]; then
  echo "Info: --keep-source enabled; leaving scans in place"
fi

# ── Summary ────────────────────────────────────────────────────

TOTAL_ELAPSED=$(( $(date +%s) - PIPELINE_START ))
AD_COUNT=$(python -c "
import json
with open('$EDITION_JSON') as f:
    print(len(json.load(f).get('ads',[])))
")

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "✓ Edition $DATE processed successfully (${TOTAL_ELAPSED}s total)"
echo "  Articles: $ARTICLE_COUNT  |  Ads: $AD_COUNT"
echo "  Stages:  OCR ${S1_ELAPSED}s  |  Cleanup ${S2_ELAPSED}s  |  Upload ${S3_ELAPSED}s  |  Seed ${S4_ELAPSED}s"
if [[ "$KEEP_SOURCE" == "false" && -d "$PROCESSED_DIR/$(basename "$EDITION_PATH")" ]]; then
  echo "  Scan moved to: ocr/done/"
elif [[ "$KEEP_SOURCE" == "true" ]]; then
  echo "  Scan preserved in source path"
fi
echo "  Logs: $LOG_DIR/"
echo "  Summary: $LOG_DIR/pipeline-summary.json"
echo "════════════════════════════════════════════════════════════════"
