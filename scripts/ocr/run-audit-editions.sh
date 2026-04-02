#!/usr/bin/env bash
# OCR Pipeline Audit — Run two editions end-to-end
# Input A: 1988-10-12 (8 pages) | Input B: 1992-05-01 (16 pages)
#
# Usage: bash scripts/ocr/run-audit-editions.sh
# Run from the project root directory.

set -euo pipefail
cd "$(dirname "$0")/../.."

echo "═══════════════════════════════════════════════════"
echo "  OCR PIPELINE AUDIT — Processing 2 editions"
echo "═══════════════════════════════════════════════════"
echo ""

# ── Input A: 1988-10-12 (8 pages) ──────────────────────
echo "▶ INPUT A: 1988-10-12 (8 pages)"
echo "  Start: $(date)"
START_A=$(date +%s)

bash scripts/ocr/process-edition.sh ocr/inbox/1988-10-12
RC_A=$?

END_A=$(date +%s)
ELAPSED_A=$((END_A - START_A))
echo "  Finished Input A in ${ELAPSED_A}s (exit code: ${RC_A})"
echo ""

# ── Input B: 1992-05-01 (16 pages) ─────────────────────
echo "▶ INPUT B: 1992-05-01 (16 pages)"
echo "  Start: $(date)"
START_B=$(date +%s)

bash scripts/ocr/process-edition.sh ocr/inbox/1992-05-01
RC_B=$?

END_B=$(date +%s)
ELAPSED_B=$((END_B - START_B))
echo "  Finished Input B in ${ELAPSED_B}s (exit code: ${RC_B})"
echo ""

# ── Summary ─────────────────────────────────────────────
echo "═══════════════════════════════════════════════════"
echo "  AUDIT RUN COMPLETE"
echo "  Input A (1988-10-12): ${ELAPSED_A}s — exit ${RC_A}"
echo "  Input B (1992-05-01): ${ELAPSED_B}s — exit ${RC_B}"
echo ""
echo "  Outputs:"
echo "    public/editions/1988-10-12/edition.json"
echo "    public/editions/1992-05-01/edition.json"
echo "    ocr/runs/1988-10-12/"
echo "    ocr/runs/1992-05-01/"
echo "═══════════════════════════════════════════════════"
