# OCR Pipeline Quality Overhaul — Design Spec

## Context

The OCR pipeline processes scanned TIF newspaper images into structured `edition.json` files. After running many editions, quality is inconsistent. A code audit revealed concrete issues:

- **Two separate letters to the editor merged into one article** — Gemini treats the entire letters column as a single article
- **OCR artifacts at merge boundaries** — truncated words (`"secretari"`, `"everal articles"`, `"ded. A the end"`) from page-break stitching
- **Non-numeric continuation references** — `"Back Page"` instead of page numbers
- **Wrong categorization** — syndicated columns with product placement classified as "Campus News"
- **Logos classified as articles** — organization seals and newspaper mastheads appear as articles
- **Preprocessing + YOLO run twice** — Phase 2 reopens the original image and reprocesses instead of reusing Phase 1 output
- **One bad page kills entire edition** — Phase 1 fail-fast aborts on any DocAI error

## Scope

OCR pipeline Python code only. No changes to frontend, database, or API layer. All changes are in `ocr/src/transcript_ocr/`.

---

## 1. Prompt Improvements

### 1.1 DOCAI_SYSTEM_PROMPT (`recognition/prompts.py:73-125`)

Add these rules to the existing prompt:

**Letters-to-editor splitting:**
> "Each Letter to the Editor is a SEPARATE article. Letters typically end with a signature line (a dash or newline followed by a name, e.g. '- John Smith'). When you see a new salutation ('Editor, the Transcript:') or a new signature followed by a new heading, start a new article. Do not combine multiple signed letters into one article."

**continues_on normalization:**
> "The `continues_on` and `continued_from` fields must contain ONLY a page number as digits (e.g., '5'). If the source text says 'Back Page', 'next page', or similar phrases, set the field to '?' — never include textual descriptions."

**Syndicated columns:**
> "Syndicated humor or entertainment columns (nationally distributed content, often with embedded product mentions or sponsor attributions) are 'Arts & Entertainment', not 'Campus News'. Look for signs like copyright notices (e.g., '(C) 1960 Author Name'), sponsor mentions, or 'The makers of X' language."

**Logos/seals:**
> "Organization logos, newspaper association seals, award emblems, and masthead graphics should go in `other_content` with a descriptive title, not as articles."

### 1.2 MERGE_PROMPT (`recognition/prompts.py:39-71`)

Simplify from 10 rules to 6 clear rules:

1. Merge ONLY when explicit continuation markers match (reciprocal page references, or one-sided marker with matching headline)
2. Never merge articles with distinct, substantive headlines — even if on similar topics
3. Never merge a photo-only entry (body < 100 chars) into an article body
4. Every article must appear in exactly one group
5. When multiple articles on the same page reference the same continuation page, match them 1:1 by headline/content similarity — read previews carefully
6. Confidence scoring: 1.0 = reciprocal markers, 0.8-0.9 = one-sided with headline match, 0.5-0.7 = content similarity alone, < 0.5 = keep separate

Remove: verbose examples that repeat the same concept, conflicting instructions about OCR garbling (move to a single clear rule about tolerating misspellings in markers).

**Files:** `ocr/src/transcript_ocr/recognition/prompts.py`

---

## 2. Continuation Marker Handling

### 2.1 New patterns (`merging/continuation.py:7-28`)

Add patterns for textual page references:
- `r"\b(?:back|last|final)\s+page\b"` → extracted as continues_on="?"
- `r"\bnext\s+page\b"` → extracted as continues_on="?"
- `r"\bpreceding\s+page\b"` → extracted as continued_from="?"

### 2.2 Post-extraction normalization (`merging/continuation.py:31-61`)

In `_extract_continuation_info()`, after extracting the page reference:
- Strip "page" prefix if present (e.g., "page 5" → "5")
- If result is non-numeric (e.g., "Back Page"), set to "?"
- Trim whitespace

**Files:** `ocr/src/transcript_ocr/merging/continuation.py`

---

## 3. Merge Improvements

### 3.1 Better deterministic pre-merge (`merging/deterministic_merge.py`)

Current behavior: skips all multi-article continuations (when `source_counts[page_pair] > 1`).

New behavior: when multiple source articles continue to the same target page AND multiple stubs exist on the target page:
1. Compute headline similarity between each source-stub pair using existing `_headline_similar()`
2. Also compute body text overlap using `_sentence_overlap()` from deduplication module
3. If a unique 1:1 match can be established (each source maps to exactly one stub with score > 0.5), merge deterministically
4. Otherwise, leave for LLM merge to resolve

### 3.2 Merge boundary text cleanup (NEW module)

Add `merging/boundary_cleanup.py` with a `clean_merge_boundaries()` function:

When two article bodies are stitched together during merge:
1. **Truncated word joining:** If the last word of segment 1 has no trailing punctuation AND the first word of segment 2 starts lowercase, concatenate them into one word (e.g., `"secretari" + "al"` → `"secretarial"`)
2. **Orphaned fragment removal:** If segment 1 ends with a fragment < 20 chars that doesn't end with sentence-terminal punctuation (`.!?"`), AND it doesn't look like a complete clause, strip it (e.g., `"ded. A"` is a garbled OCR fragment)
3. **Duplicate sentence removal at seam:** If the last sentence of segment 1 matches the first sentence of segment 2 (normalized), remove the duplicate

Called in `llm_merge.py` after merge groups are assembled, before final output.

### 3.3 Merge confidence filtering (`merging/llm_merge.py`)

Add environment variable `MERGE_MIN_CONFIDENCE` (default: 0.5).

After LLM merge returns groups with confidence scores:
- Groups with confidence < threshold → split back into individual articles
- Log the rejection with article IDs and confidence value
- Track in `MergePassDiagnostics` as `low_confidence_rejections: int`

**Files:**
- `ocr/src/transcript_ocr/merging/deterministic_merge.py`
- `ocr/src/transcript_ocr/merging/boundary_cleanup.py` (new)
- `ocr/src/transcript_ocr/merging/llm_merge.py`

---

## 4. Post-Processing Fixes

### 4.1 Null sanitizer (`postprocessing/null_sanitizer.py`)

Expand the null-like values set to include case-insensitive matching:
- Convert candidate to `.strip().lower()` before checking
- Add `"n/a"`, `"unknown"`, `"<none>"` to the set
- The set becomes: `{"null", "none", "n/a", "undefined", "nil", "unknown", "<none>"}`

### 4.2 Byline cleanup (`postprocessing/byline_cleanup.py`)

Add position titles: `"Bureau Chief"`, `"Correspondent"`, `"Contributing Writer"`, `"Special to the Transcript"`, `"Managing Editor"`, `"News Editor"`, `"Assistant Editor"`.

Add byline deduplication: if article body starts with `"By <author>"` and `author` field matches, strip the byline from the body to prevent duplication.

**Files:**
- `ocr/src/transcript_ocr/postprocessing/null_sanitizer.py`
- `ocr/src/transcript_ocr/postprocessing/byline_cleanup.py`

---

## 5. Pipeline Architecture

### 5.1 Eliminate preprocessing + YOLO duplication

**Problem:** Phase 1 (`extract_page_docai` in `page_pipeline.py:49`) preprocesses the image and detects regions. Phase 2 (`process_page_with_docai` in `page_extractor.py:44-47`) reopens the original file and runs both preprocessing AND YOLO detection again.

**Fix:** Modify `process_page_with_docai()` to accept the preprocessed image and regions from Phase 1 instead of recomputing them. The function signature changes from:

```python
def process_page_with_docai(client, image_path, docai_result, ...)
```

to:

```python
def process_page_with_docai(client, image_path, docai_result, preprocessed_image, regions, ...)
```

Remove the `preprocess_image()` and `detect_image_regions()` calls inside the function. Use the passed-in values.

Update `structure_and_link_page()` in `page_pipeline.py` to pass the Phase 1 results through.

### 5.2 Phase 1 graceful page skip (`application/edition_pipeline.py`)

**Problem:** DocAI error on any page aborts the entire edition via fail-fast in Phase 1.

**Fix:** Wrap individual page processing in try/except:
- Catch DocAI errors per page
- Log error, record in `PageDiagnostics.error`
- Skip that page, continue with remaining pages
- Track `pages_attempted` and `pages_succeeded` 
- Only abort if ALL pages fail (no content extracted)

### 5.3 Pre-OCR page quality check (NEW)

Before calling DocAI (API cost), check image quality:
- **Blank detection:** Convert to grayscale array, check if >95% of pixels are within 10 values of the mode → blank page, skip
- **Low resolution:** If image is < 500px in either dimension, log warning (still process but flag in diagnostics)
- **Inverted scan:** If median pixel value < 64 (mostly dark), the scan may be inverted — log warning

Add as `_check_page_quality()` in `preprocessing/image_preprocessor.py`, called at start of `extract_page_docai()`.

**Files:**
- `ocr/src/transcript_ocr/recognition/page_extractor.py`
- `ocr/src/transcript_ocr/application/page_pipeline.py`
- `ocr/src/transcript_ocr/application/edition_pipeline.py`
- `ocr/src/transcript_ocr/preprocessing/image_preprocessor.py`

---

## 6. Preprocessing Tuning

### 6.1 Skew detection range (`preprocessing/skew.py:22`)

Change `range(-50, 51)` to `range(-150, 151)` — extends from ±5° to ±15°.

### 6.2 CLAHE clip limit (`config/constants.py:27`)

Raise `DOCAI_CLAHE_CLIP_LIMIT` from 2.0 to 3.5 — better contrast enhancement for faded 1960s newsprint. Only affects DocAI image preparation.

### 6.3 Unsharp mask (`preprocessing/image_preprocessor.py:31`)

Reduce `percent` from 80 to 50 — current value amplifies noise on aged paper.

**Files:**
- `ocr/src/transcript_ocr/preprocessing/skew.py`
- `ocr/src/transcript_ocr/config/constants.py`
- `ocr/src/transcript_ocr/preprocessing/image_preprocessor.py`

---

## Files Modified (Complete List)

| File | Changes |
|------|---------|
| `recognition/prompts.py` | Add 4 prompt rules (letters splitting, continues_on normalization, syndicated columns, logos); simplify MERGE_PROMPT |
| `merging/continuation.py` | Add textual page reference patterns; normalize non-numeric references to "?" |
| `merging/deterministic_merge.py` | Handle multi-article continuations with headline+content matching |
| `merging/boundary_cleanup.py` | NEW: post-merge text cleanup at join points |
| `merging/llm_merge.py` | Add MERGE_MIN_CONFIDENCE filtering; integrate boundary cleanup |
| `postprocessing/null_sanitizer.py` | Case-insensitive matching, expanded null-like set |
| `postprocessing/byline_cleanup.py` | Expanded position titles, byline deduplication |
| `recognition/page_extractor.py` | Remove duplicate preprocessing+YOLO; accept preprocessed inputs |
| `application/page_pipeline.py` | Pass Phase 1 outputs to Phase 2; pre-OCR quality check |
| `application/edition_pipeline.py` | Graceful page skip on DocAI error |
| `preprocessing/image_preprocessor.py` | Reduce unsharp mask; add quality check function |
| `preprocessing/skew.py` | Extend range to ±15° |
| `config/constants.py` | Raise CLAHE clip limit to 3.5 |

---

## Verification Plan

### Unit tests

Run existing test suite to confirm no regressions:
```bash
python -m pytest tests/ocr/ -x
```

Add targeted tests for:
- `boundary_cleanup.py`: test truncated word joining, duplicate sentence removal
- `continuation.py`: test new textual patterns ("Back Page" → "?")
- `deterministic_merge.py`: test multi-article continuation matching
- `null_sanitizer.py`: test case-insensitive matching

### Integration test

Reprocess the `1960-01-13` edition (already has TIFs in inbox):
```bash
scripts/ocr/process-edition.sh "ocr/inbox/1960-01-13" --keep-source --run-id quality-overhaul
```

Compare output against current `public/editions/1960-01-13/edition.json`:
- Article 11 (Coed Dress + Greek Troubles) should be split into 2 separate articles
- Article 5 (Kelly grant) body should not have truncated words at merge boundary
- Article 15 (On Campus) should be categorized as "Arts & Entertainment"
- Seal of Ohio College Newspaper Association should be in `other_content`

### Batch validation

Process 2-3 additional editions with `--keep-source` and inspect:
- Continuation markers resolved to page numbers (no "Back Page")
- Multi-page articles properly merged
- No articles lost from graceful page skip
