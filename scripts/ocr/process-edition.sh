#!/usr/bin/env bash
set -euo pipefail

# Transactional OCR publication for one newspaper edition.
#
# Normal:
#   scripts/ocr/process-edition.sh <ocr/inbox/edition-dir> [--workers N] [--seed]
#
# Explicit repair operations (validated public editions only):
#   scripts/ocr/process-edition.sh --repair-upload YYYY-MM-DD
#   scripts/ocr/process-edition.sh --repair-seed YYYY-MM-DD

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd -P)"
OCR_ROOT="$ROOT_DIR/ocr"
INBOX_ROOT="$OCR_ROOT/inbox"
PUBLIC_ROOT="$ROOT_DIR/public/editions"
STAGING_PARENT="$PUBLIC_ROOT/.staging"
ROLLBACK_PARENT="$PUBLIC_ROOT/.rollback"
LOCK_PARENT="$PUBLIC_ROOT/.locks"
WORK_PARENT="$OCR_ROOT/.work"

MODE="normal"
EDITION_PATH=""
DATE=""
WORKERS=""
SEED_AFTER_PUBLISH=false

CANDIDATE_ROOT=""
CANDIDATE_EDITION=""
WORK_ROOT=""
LOCK_DIR=""
ASSET_LOCK_DIR="$LOCK_PARENT/assets.lock"
ASSET_LOCK_HELD=false
ROLLBACK_CONTAINER=""
SOURCE_ABS=""
INPUT_CLEANUP_ARMED=false
FAILURE_STAGE="preflight"
FAILURE_REASON=""
START_SECONDS=$SECONDS

usage() {
  cat <<'EOF'
Usage:
  scripts/ocr/process-edition.sh <edition-dir> [--workers N] [--seed]
  scripts/ocr/process-edition.sh --repair-upload YYYY-MM-DD
  scripts/ocr/process-edition.sh --repair-seed YYYY-MM-DD
EOF
}

fail() {
  local exit_code="$1"
  local stage="$2"
  local reason="$3"
  FAILURE_STAGE="$stage"
  FAILURE_REASON="$reason"
  echo "ERROR: $reason" >&2
  exit "$exit_code"
}

is_path_below() {
  local child="$1"
  local parent="$2"
  [[ -n "$child" && -n "$parent" && "$child" != "$parent" && "$child" == "$parent"/* ]]
}

safe_remove_tree() {
  local target="$1"
  local required_parent="$2"
  if [[ -z "$target" || ! -e "$target" ]]; then
    return 0
  fi
  if ! is_path_below "$target" "$required_parent"; then
    echo "WARNING: refusing cleanup outside $required_parent: $target" >&2
    return 1
  fi
  rm -rf -- "$target"
}

log_failure_metadata() {
  local status="$1"
  local reason="$2"
  if [[ -z "$DATE" || ! -f "$OCR_ROOT/log_failure.py" ]]; then
    return 0
  fi
  python3 "$OCR_ROOT/log_failure.py" \
    --edition "$DATE" \
    --stage "$FAILURE_STAGE" \
    --status "$status" \
    --error "$reason" >/dev/null 2>&1 || true
}

restore_rollback_if_needed() {
  local final_edition="$PUBLIC_ROOT/$DATE"
  local saved_edition="${ROLLBACK_CONTAINER:+$ROLLBACK_CONTAINER/edition}"
  if [[ -z "$ROLLBACK_CONTAINER" || ( ! -e "$saved_edition" && ! -L "$saved_edition" ) ]]; then
    return 0
  fi
  if [[ -e "$final_edition" ]]; then
    echo "WARNING: rollback retained at $saved_edition because public target exists" >&2
    return 1
  fi
  if mv -- "$saved_edition" "$final_edition"; then
    safe_remove_tree "$ROLLBACK_CONTAINER" "$ROLLBACK_PARENT" || true
    ROLLBACK_CONTAINER=""
    return 0
  fi
  echo "WARNING: automatic rollback restoration failed; preserved $saved_edition" >&2
  return 1
}

on_exit() {
  local exit_code=$?
  trap - EXIT INT TERM HUP
  set +e

  if [[ $exit_code -ne 0 ]]; then
    restore_rollback_if_needed || true
    log_failure_metadata "failed" "${FAILURE_REASON:-process exited with status $exit_code}"
  fi

  safe_remove_tree "$CANDIDATE_ROOT" "$STAGING_PARENT" || true
  safe_remove_tree "$WORK_ROOT" "$WORK_PARENT" || true

  if [[ "$INPUT_CLEANUP_ARMED" == "true" ]] && is_path_below "$SOURCE_ABS" "$INBOX_ROOT"; then
    safe_remove_tree "$SOURCE_ABS" "$INBOX_ROOT" || true
  fi

  if [[ -n "$LOCK_DIR" && -d "$LOCK_DIR" ]]; then
    rmdir -- "$LOCK_DIR" 2>/dev/null || true
  fi
  if [[ "$ASSET_LOCK_HELD" == "true" && -d "$ASSET_LOCK_DIR" ]]; then
    rmdir -- "$ASSET_LOCK_DIR" 2>/dev/null || true
  fi
  exit "$exit_code"
}

trap on_exit EXIT
trap 'FAILURE_STAGE="signal"; FAILURE_REASON="process interrupted"; exit 130' INT TERM HUP

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workers)
      [[ $# -ge 2 ]] || fail 2 "arguments" "--workers requires a positive integer"
      WORKERS="$2"
      shift 2
      ;;
    --seed)
      SEED_AFTER_PUBLISH=true
      shift
      ;;
    --repair-upload)
      [[ $# -ge 2 ]] || fail 2 "arguments" "--repair-upload requires YYYY-MM-DD"
      [[ "$MODE" == "normal" && -z "$EDITION_PATH" ]] || fail 2 "arguments" "repair modes are mutually exclusive"
      MODE="repair-upload"
      DATE="$2"
      shift 2
      ;;
    --repair-seed)
      [[ $# -ge 2 ]] || fail 2 "arguments" "--repair-seed requires YYYY-MM-DD"
      [[ "$MODE" == "normal" && -z "$EDITION_PATH" ]] || fail 2 "arguments" "repair modes are mutually exclusive"
      MODE="repair-seed"
      DATE="$2"
      shift 2
      ;;
    -*)
      usage >&2
      fail 2 "arguments" "unknown option: $1"
      ;;
    *)
      [[ "$MODE" == "normal" ]] || fail 2 "arguments" "repair mode does not accept an edition directory"
      [[ -z "$EDITION_PATH" ]] || fail 2 "arguments" "multiple edition directories supplied"
      EDITION_PATH="$1"
      shift
      ;;
  esac
done

if [[ -n "$WORKERS" && ! "$WORKERS" =~ ^[1-9][0-9]*$ ]]; then
  fail 2 "arguments" "--workers must be a positive integer"
fi
if [[ "$MODE" != "normal" && "$SEED_AFTER_PUBLISH" == "true" ]]; then
  fail 2 "arguments" "--seed is only valid with a normal OCR run"
fi

if [[ "$MODE" == "normal" ]]; then
  [[ -n "$EDITION_PATH" ]] || { usage >&2; fail 2 "arguments" "edition directory is required"; }
  [[ -d "$EDITION_PATH" ]] || fail 2 "preflight" "edition directory not found: $EDITION_PATH"
  SOURCE_ABS="$(cd "$EDITION_PATH" && pwd -P)"
  INPUT_CLEANUP_ARMED=true
  source_name="$(basename "$SOURCE_ABS")"
  if [[ "$source_name" =~ ([0-9]{4}-[0-9]{2}-[0-9]{2}) ]]; then
    DATE="${BASH_REMATCH[1]}"
  else
    fail 2 "preflight" "edition directory name must contain YYYY-MM-DD"
  fi
else
  [[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail 2 "arguments" "repair date must be YYYY-MM-DD"
fi

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

export GOOGLE_GENAI_USE_VERTEXAI=true
export GOOGLE_CLOUD_LOCATION=global
export OCR_ENVIRONMENT=production

if [[ "$MODE" == "normal" || "$MODE" == "repair-seed" ]]; then
  [[ -n "${GOOGLE_CLOUD_PROJECT:-}" ]] || fail 2 "preflight" "GOOGLE_CLOUD_PROJECT is required for Vertex AI ADC"
fi
if [[ "$MODE" == "normal" ]]; then
  [[ -n "${DOCUMENT_AI_PROCESSOR_ID:-}" ]] || fail 2 "preflight" "DOCUMENT_AI_PROCESSOR_ID is required for OCR"
  [[ -n "${DOCUMENT_AI_LOCATION:-}" ]] || fail 2 "preflight" "DOCUMENT_AI_LOCATION is required for OCR"
  detector_licenses="${OCR_DETECTOR_LICENSES_ACCEPTED:-}"
  case "$detector_licenses" in
    1|true|TRUE|True) ;;
    *) fail 2 "preflight" "OCR_DETECTOR_LICENSES_ACCEPTED=true is required for hosted OCR" ;;
  esac
fi
if [[ "$SEED_AFTER_PUBLISH" == "true" || "$MODE" == "repair-seed" ]]; then
  [[ -n "${DATABASE_URL:-}" ]] || fail 2 "preflight" "DATABASE_URL is required only for database seeding"
fi

if [[ -f "$OCR_ROOT/.venv/bin/activate" ]]; then
  # shellcheck disable=SC1091
  source "$OCR_ROOT/.venv/bin/activate"
else
  fail 2 "preflight" "Python environment not found at ocr/.venv"
fi

mkdir -p "$PUBLIC_ROOT" "$STAGING_PARENT" "$ROLLBACK_PARENT" "$LOCK_PARENT" "$WORK_PARENT"
LOCK_DIR="$LOCK_PARENT/$DATE.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  LOCK_DIR=""
  # A competing process may be reading this same source; never remove it here.
  INPUT_CLEANUP_ARMED=false
  fail 75 "lock" "edition $DATE is already being processed"
fi

validate_edition_dir() {
  local edition_dir="$1"
  [[ -f "$edition_dir/edition.json" ]] || return 1
  python "$OCR_ROOT/validate_candidate.py" "$edition_dir/edition.json" --date "$DATE"
}

make_candidate_root() {
  CANDIDATE_ROOT="$(mktemp -d "$STAGING_PARENT/$DATE.XXXXXX")"
  CANDIDATE_EDITION="$CANDIDATE_ROOT/$DATE"
}

promote_candidate() {
  local final_edition="$PUBLIC_ROOT/$DATE"
  local saved_edition=""
  FAILURE_STAGE="promotion"

  validate_edition_dir "$CANDIDATE_EDITION" || return 1
  ROLLBACK_CONTAINER="$(mktemp -d "$ROLLBACK_PARENT/$DATE.XXXXXX")"
  saved_edition="$ROLLBACK_CONTAINER/edition"

  if [[ -e "$final_edition" || -L "$final_edition" ]]; then
    mv -- "$final_edition" "$saved_edition" || return 1
  fi
  if ! mv -- "$CANDIDATE_EDITION" "$final_edition"; then
    if [[ -e "$saved_edition" || -L "$saved_edition" ]]; then
      mv -- "$saved_edition" "$final_edition" || true
    fi
    return 1
  fi

  if ! validate_edition_dir "$final_edition"; then
    mkdir -p "$(dirname "$CANDIDATE_EDITION")"
    mv -- "$final_edition" "$CANDIDATE_EDITION" || true
    if [[ -e "$saved_edition" || -L "$saved_edition" ]]; then
      mv -- "$saved_edition" "$final_edition" || true
    fi
    return 1
  fi

  safe_remove_tree "$ROLLBACK_CONTAINER" "$ROLLBACK_PARENT" || return 1
  ROLLBACK_CONTAINER=""
  return 0
}

run_upload() {
  local editions_root="$1"
  node "$ROOT_DIR/scripts/db/upload-images.mjs" \
    --date "$DATE" \
    --editions-dir "$editions_root"
}

acquire_asset_lock() {
  if ! mkdir "$ASSET_LOCK_DIR" 2>/dev/null; then
    fail 75 "asset-lock" "asset publication or R2 garbage collection is already active"
  fi
  ASSET_LOCK_HELD=true
}

release_asset_lock() {
  if [[ "$ASSET_LOCK_HELD" == "true" ]]; then
    rmdir -- "$ASSET_LOCK_DIR" || return 1
    ASSET_LOCK_HELD=false
  fi
}

run_seed() {
  OCR_MIN_TEXT_LENGTH=0 npm run db:seed -- \
    --date "$DATE" \
    --editions-dir "$PUBLIC_ROOT"
}

if [[ "$MODE" == "repair-seed" ]]; then
  FAILURE_STAGE="repair-validation"
  validate_edition_dir "$PUBLIC_ROOT/$DATE" || fail 20 "$FAILURE_STAGE" "public edition failed structural validation"
  FAILURE_STAGE="seed"
  run_seed || fail 50 "$FAILURE_STAGE" "database seed failed"
  echo "Edition $DATE database seed repaired successfully."
  exit 0
fi

if [[ "$MODE" == "repair-upload" ]]; then
  FAILURE_STAGE="repair-validation"
  validate_edition_dir "$PUBLIC_ROOT/$DATE" || fail 20 "$FAILURE_STAGE" "public edition failed structural validation"
  make_candidate_root
  cp -R -- "$PUBLIC_ROOT/$DATE" "$CANDIDATE_EDITION"
  acquire_asset_lock
  FAILURE_STAGE="upload"
  run_upload "$CANDIDATE_ROOT" || fail 30 "$FAILURE_STAGE" "asset upload repair failed"
  FAILURE_STAGE="post-upload-validation"
  validate_edition_dir "$CANDIDATE_EDITION" || fail 20 "$FAILURE_STAGE" "repaired candidate failed structural validation"
  promote_candidate || fail 40 "promotion" "atomic public replacement failed"
  release_asset_lock || fail 75 "asset-lock" "could not release asset publication lock"
  echo "Edition $DATE asset upload repaired and published successfully."
  exit 0
fi

make_candidate_root
WORK_ROOT="$(mktemp -d "$WORK_PARENT/$DATE.XXXXXX")"

echo "Processing edition $DATE"
echo "Source: $SOURCE_ABS"

OCR_COMMAND=(
  python "$OCR_ROOT/convert_scans.py"
  "$SOURCE_ABS"
  --output-root "$CANDIDATE_ROOT"
  --work-root "$WORK_ROOT"
)
if [[ -n "$WORKERS" ]]; then
  OCR_COMMAND+=(--workers "$WORKERS")
fi

FAILURE_STAGE="ocr"
if ! "${OCR_COMMAND[@]}"; then
  fail 10 "$FAILURE_STAGE" "OCR extraction failed"
fi

FAILURE_STAGE="candidate-validation"
validate_edition_dir "$CANDIDATE_EDITION" || fail 20 "$FAILURE_STAGE" "OCR candidate failed structural validation"

acquire_asset_lock
FAILURE_STAGE="upload"
run_upload "$CANDIDATE_ROOT" || fail 30 "$FAILURE_STAGE" "asset optimization or upload failed"

FAILURE_STAGE="post-upload-validation"
validate_edition_dir "$CANDIDATE_EDITION" || fail 20 "$FAILURE_STAGE" "uploaded candidate failed structural validation"

promote_candidate || fail 40 "promotion" "atomic public replacement failed"
release_asset_lock || fail 75 "asset-lock" "could not release asset publication lock"

if [[ "$SEED_AFTER_PUBLISH" == "true" ]]; then
  FAILURE_STAGE="seed"
  run_seed || fail 50 "$FAILURE_STAGE" "database seed failed after publication"
fi

read -r ARTICLE_COUNT AD_COUNT < <(
  python - "$PUBLIC_ROOT/$DATE/edition.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    edition = json.load(handle)
print(len(edition.get("articles", [])), len(edition.get("ads", [])))
PY
)

ELAPSED=$((SECONDS - START_SECONDS))
echo "Edition $DATE published successfully in ${ELAPSED}s."
echo "Articles: $ARTICLE_COUNT | Ads: $AD_COUNT | Seeded: $SEED_AFTER_PUBLISH"
