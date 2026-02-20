#!/bin/bash
set -euo pipefail

# ── process-edition.sh ──────────────────────────────────────────
# Processes a single newspaper edition through the full pipeline:
#   OCR → enrich articles → enrich ads → image cleanup → seed → embed
#
# Usage:
#   scripts/process-edition.sh <path-to-edition-scan-dir>
#
# Example:
#   scripts/process-edition.sh "ocr/scans/unprocessed/1970-01-14 The Ohio Wesleyan Transcript Delaware OH 1970-01-14"
#
# The scan directory must contain numbered TIF files (e.g., 0001_Page 1.tif).
# On success, the directory is moved to ocr/scans/processed/.
# ────────────────────────────────────────────────────────────────

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# ── Args ────────────────────────────────────────────────────────

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/process-edition.sh <path-to-edition-scan-dir>"
  exit 1
fi

EDITION_PATH="$1"

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
echo "════════════════════════════════════════════════════════════════"

# ── Environment ─────────────────────────────────────────────────

if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  source "$ROOT_DIR/.env.local"
  set +a
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

LOG_DIR="$ROOT_DIR/ocr/output/$DATE"
mkdir -p "$LOG_DIR"

# ── Stage 1: OCR ───────────────────────────────────────────────

echo ""
echo "── Stage 1/5: OCR extraction ──────────────────────────────"
python "$ROOT_DIR/ocr/convert_scans.py" "$EDITION_PATH" 2>&1 | tee "$LOG_DIR/ocr.log"

# Validate OCR output
EDITION_JSON="$ROOT_DIR/public/editions/$DATE/edition.json"
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

echo "  ✓ OCR complete: $ARTICLE_COUNT articles extracted"

# ── Stage 2: Article enrichment ────────────────────────────────

echo ""
echo "── Stage 2/5: Article enrichment ──────────────────────────"
python "$ROOT_DIR/ocr/enrich_articles.py" --date "$DATE" 2>&1 | tee "$LOG_DIR/enrich-articles.log"

# Validate categories
CAT_COUNT=$(python3 -c "
import json
with open('$EDITION_JSON') as f:
    d = json.load(f)
print(len(d.get('categories', [])))
")

if [[ "$CAT_COUNT" != "$ARTICLE_COUNT" ]]; then
  echo "WARNING: Category count ($CAT_COUNT) != article count ($ARTICLE_COUNT)"
fi

echo "  ✓ Categories assigned: $CAT_COUNT"

# ── Stage 3: Ad enrichment ─────────────────────────────────────

echo ""
echo "── Stage 3/5: Ad enrichment ───────────────────────────────"
python "$ROOT_DIR/ocr/enrich_ads.py" --date "$DATE" 2>&1 | tee "$LOG_DIR/enrich-ads.log"

AD_COUNT=$(python3 -c "
import json
with open('$EDITION_JSON') as f:
    d = json.load(f)
print(len(d.get('ads', [])))
")

ENRICHED_AD_COUNT=$(python3 -c "
import json
with open('$EDITION_JSON') as f:
    d = json.load(f)
print(len(d.get('enriched_ads', [])))
")

if [[ "$ENRICHED_AD_COUNT" != "$AD_COUNT" ]]; then
  echo "WARNING: Enriched ad count ($ENRICHED_AD_COUNT) != ad count ($AD_COUNT)"
fi

echo "  ✓ Ads enriched: $ENRICHED_AD_COUNT / $AD_COUNT"

# ── Stage 4: Image cleanup ─────────────────────────────────────

echo ""
echo "── Stage 4/5: Image cleanup ───────────────────────────────"
node "$ROOT_DIR/scripts/cleanup-images.mjs" --apply 2>&1 | tee "$LOG_DIR/cleanup-images.log"
echo "  ✓ Image cleanup applied"

# ── Stage 5: Database seed + embed ─────────────────────────────

echo ""
echo "── Stage 5/5: Database seed ───────────────────────────────"
npm run db:seed 2>&1 | tee "$LOG_DIR/seed.log"
echo "  ✓ Database seeded"

# ── Move to processed ──────────────────────────────────────────

PROCESSED_DIR="$ROOT_DIR/ocr/scans/processed"
mkdir -p "$PROCESSED_DIR"
mv "$EDITION_PATH" "$PROCESSED_DIR/"

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "✓ Edition $DATE processed successfully"
echo "  Articles: $ARTICLE_COUNT  |  Ads: $AD_COUNT"
echo "  Scan moved to: ocr/scans/processed/"
echo "  Logs: ocr/output/$DATE/"
echo "════════════════════════════════════════════════════════════════"
