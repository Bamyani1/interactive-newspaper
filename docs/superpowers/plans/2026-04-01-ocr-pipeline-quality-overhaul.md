# OCR Pipeline Quality Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the top OCR quality issues: wrong merges, text artifacts at boundaries, bad categorization, duplicate processing, and fail-fast crashes that kill entire editions.

**Architecture:** Targeted changes across 13 Python files in `ocr/src/transcript_ocr/`. No new dependencies. No changes to frontend/API/DB. One new module (`merging/boundary_cleanup.py`), rest are modifications to existing code. TDD — every behavioral change has a test first.

**Tech Stack:** Python 3.12, pytest, Gemini API (prompts only — no SDK changes), PIL/Pillow, numpy/scipy

**Spec:** `docs/superpowers/specs/2026-04-01-ocr-pipeline-quality-overhaul-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `ocr/src/transcript_ocr/recognition/prompts.py` | Modify | Gemini prompt text for structuring + merging |
| `ocr/src/transcript_ocr/merging/continuation.py` | Modify | Continuation marker patterns + normalization |
| `ocr/src/transcript_ocr/merging/boundary_cleanup.py` | Create | Post-merge text cleanup at join points |
| `ocr/src/transcript_ocr/merging/deterministic_merge.py` | Modify | Multi-article continuation matching |
| `ocr/src/transcript_ocr/merging/llm_merge.py` | Modify | Confidence filtering + boundary cleanup integration |
| `ocr/src/transcript_ocr/postprocessing/null_sanitizer.py` | Modify | Expanded null-like value set |
| `ocr/src/transcript_ocr/postprocessing/byline_cleanup.py` | Modify | Position titles + byline dedup |
| `ocr/src/transcript_ocr/preprocessing/skew.py` | Modify | Extended skew range |
| `ocr/src/transcript_ocr/preprocessing/image_preprocessor.py` | Modify | Unsharp mask tuning + page quality check |
| `ocr/src/transcript_ocr/config/constants.py` | Modify | CLAHE clip limit |
| `ocr/src/transcript_ocr/recognition/page_extractor.py` | Modify | Remove duplicate preprocessing/YOLO |
| `ocr/src/transcript_ocr/application/page_pipeline.py` | Modify | Pass Phase 1 results to Phase 2 |
| `ocr/src/transcript_ocr/application/edition_pipeline.py` | Modify | Graceful page skip |
| `ocr/src/transcript_ocr/contracts/diagnostics_models.py` | Modify | Add `low_confidence_rejections` field |

---

### Task 1: Null sanitizer expansion

**Files:**
- Modify: `ocr/src/transcript_ocr/postprocessing/null_sanitizer.py:7`
- Test: `tests/ocr/test_null_sanitizer.py`

- [ ] **Step 1: Write failing tests for new null-like values**

Add to `tests/ocr/test_null_sanitizer.py`:

```python
def test_sanitizes_unknown_string():
    page = _make_page(articles=[
        Article(headline="Test", body="body", author="UNKNOWN"),
    ])
    result = _sanitize_null_strings(page)
    assert result.articles[0].author == ""


def test_sanitizes_angle_bracket_none():
    page = _make_page(articles=[
        Article(headline="Test", body="body", writer_position="<None>"),
    ])
    result = _sanitize_null_strings(page)
    assert result.articles[0].writer_position == ""
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/ocr/test_null_sanitizer.py::test_sanitizes_unknown_string tests/ocr/test_null_sanitizer.py::test_sanitizes_angle_bracket_none -v`
Expected: FAIL — "UNKNOWN" and "<None>" not in current `_NULL_STRINGS` set.

- [ ] **Step 3: Expand the null strings set**

In `ocr/src/transcript_ocr/postprocessing/null_sanitizer.py`, change line 7:

```python
_NULL_STRINGS = {"null", "none", "n/a", "undefined", "nil", "unknown", "<none>"}
```

No other changes needed — the existing code already does `.strip().lower()` before checking.

- [ ] **Step 4: Run all null sanitizer tests**

Run: `python -m pytest tests/ocr/test_null_sanitizer.py -v`
Expected: All PASS (11 tests including 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add ocr/src/transcript_ocr/postprocessing/null_sanitizer.py tests/ocr/test_null_sanitizer.py
git commit -m "fix(ocr): expand null sanitizer to catch UNKNOWN and <None>"
```

---

### Task 2: Continuation marker improvements

**Files:**
- Modify: `ocr/src/transcript_ocr/merging/continuation.py`
- Test: `tests/ocr/test_continuation.py`

- [ ] **Step 1: Write failing tests for textual page references**

Add to `tests/ocr/test_continuation.py`:

```python
def test_strip_back_page():
    text = "Article text continued on back page"
    result = _strip_continuation_markers(text)
    assert "back page" not in result.lower()


def test_strip_next_page():
    text = "Article text continued on next page"
    result = _strip_continuation_markers(text)
    assert "next page" not in result.lower()


def test_extract_back_page_as_ambiguous():
    """'Back page' cannot be resolved to a number — should return '?'."""
    info = _extract_continuation_info("End of text. Continued on back page")
    assert info["continues_on"] == "?"


def test_extract_preceding_page_as_ambiguous():
    info = _extract_continuation_info("Continued from preceding page. The story goes on.")
    assert info["continued_from"] == "?"


def test_extract_normalizes_non_numeric():
    """Any non-numeric continuation reference should normalize to '?'."""
    info = _extract_continuation_info("See last page for conclusion")
    assert info["continues_on"] == "?"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/ocr/test_continuation.py::test_strip_back_page tests/ocr/test_continuation.py::test_extract_back_page_as_ambiguous tests/ocr/test_continuation.py::test_extract_normalizes_non_numeric -v`
Expected: FAIL

- [ ] **Step 3: Add new patterns and post-extraction normalization**

In `ocr/src/transcript_ocr/merging/continuation.py`:

Add three patterns to `_CONTINUATION_PATTERNS` list (before the closing `]` at line 27):

```python
        # Textual page references (non-numeric — will be normalized to "?")
        r"\bcontinued\s+on\s+(?:the\s+)?(?:back|last|final|next)\s+page\b",
        r"\bcontinued\s+from\s+(?:the\s+)?(?:preceding|previous|last)\s+page\b",
        r"\bsee\s+(?:the\s+)?(?:back|last|final|next)\s+page\b",
```

Add a normalization helper and modify `_extract_continuation_info`. After the existing function body (before the `return info` at line 61), add normalization:

```python
    # Fallback: textual page references (back page, next page, etc.)
    if not info["continues_on"]:
        match = re.search(
            r"\b(?:continued\s+on|see)\s+(?:the\s+)?(?:back|last|final|next)\s+page\b",
            body,
            re.IGNORECASE,
        )
        if match:
            info["continues_on"] = "?"

    if not info["continued_from"]:
        match = re.search(
            r"\bcontinued\s+from\s+(?:the\s+)?(?:preceding|previous|last)\s+page\b",
            body,
            re.IGNORECASE,
        )
        if match:
            info["continued_from"] = "?"

    # Normalize: any non-numeric result becomes "?"
    for key in ("continues_on", "continued_from"):
        val = info[key]
        if val and val != "?" and not val.strip().isdigit():
            info[key] = "?"

    return info
```

Remove the old `return info` line since we return at the end of the new block.

- [ ] **Step 4: Run all continuation tests**

Run: `python -m pytest tests/ocr/test_continuation.py -v`
Expected: All PASS (18 tests including 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add ocr/src/transcript_ocr/merging/continuation.py tests/ocr/test_continuation.py
git commit -m "fix(ocr): handle textual continuation references (back page, next page)"
```

---

### Task 3: Merge boundary cleanup module

**Files:**
- Create: `ocr/src/transcript_ocr/merging/boundary_cleanup.py`
- Create: `tests/ocr/test_boundary_cleanup.py`

- [ ] **Step 1: Write failing tests**

Create `tests/ocr/test_boundary_cleanup.py`:

```python
"""Unit tests for merge boundary text cleanup."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OCR_SRC = ROOT / "ocr" / "src"
if str(OCR_SRC) not in sys.path:
    sys.path.insert(0, str(OCR_SRC))

from transcript_ocr.merging.boundary_cleanup import clean_merge_boundary


def test_joins_truncated_word():
    """'secretari' + 'al services' → 'secretarial services'."""
    seg1 = "including secretari"
    seg2 = "al services for the project."
    result = clean_merge_boundary(seg1, seg2)
    assert result == "including secretarial services for the project."


def test_removes_duplicate_sentence_at_seam():
    """Same sentence at end of seg1 and start of seg2 → deduplicated."""
    seg1 = "First paragraph.\n\nThe court decided the case."
    seg2 = "The court decided the case.\n\nNext paragraph."
    result = clean_merge_boundary(seg1, seg2)
    assert result.count("The court decided the case.") == 1
    assert "First paragraph." in result
    assert "Next paragraph." in result


def test_preserves_clean_boundary():
    """No changes when boundary is clean."""
    seg1 = "First article section ends here."
    seg2 = "Second article section starts here."
    result = clean_merge_boundary(seg1, seg2)
    assert result == "First article section ends here.\n\nSecond article section starts here."


def test_handles_empty_segments():
    assert clean_merge_boundary("", "Some text.") == "Some text."
    assert clean_merge_boundary("Some text.", "") == "Some text."
    assert clean_merge_boundary("", "") == ""


def test_joins_word_split_across_boundary():
    """'everal' at start of seg2 when seg1 ends without punctuation."""
    seg1 = "He published s"
    seg2 = "everal articles on Arabia."
    result = clean_merge_boundary(seg1, seg2)
    assert "several articles" in result.lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/ocr/test_boundary_cleanup.py -v`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement the boundary cleanup module**

Create `ocr/src/transcript_ocr/merging/boundary_cleanup.py`:

```python
"""Post-merge text cleanup at article body join points."""

from __future__ import annotations

import re


def _normalize_for_compare(text: str) -> str:
    """Collapse whitespace for sentence comparison."""
    return re.sub(r"\s+", " ", text.strip()).lower()


def _last_sentence(text: str) -> str:
    """Extract the last sentence from text."""
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return sentences[-1].strip() if sentences else ""


def _first_sentence(text: str) -> str:
    """Extract the first sentence from text."""
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return sentences[0].strip() if sentences else ""


def clean_merge_boundary(seg1: str, seg2: str) -> str:
    """Clean up text at the join point between two merged article segments.

    Handles:
    1. Truncated word joining (seg1 ends mid-word, seg2 starts with rest)
    2. Duplicate sentence removal at seam
    """
    if not seg1 and not seg2:
        return ""
    if not seg1:
        return seg2
    if not seg2:
        return seg1

    seg1 = seg1.rstrip()
    seg2 = seg2.lstrip()

    # --- Truncated word joining ---
    # If seg1 ends without sentence-terminal punctuation AND seg2 starts lowercase,
    # try joining the last word of seg1 with the first word of seg2.
    last_char = seg1[-1] if seg1 else ""
    first_char = seg2[0] if seg2 else ""

    if last_char not in '.!?"\'\u201d\u2019)' and first_char.islower():
        # Join last word of seg1 with first word of seg2
        seg1_words = seg1.rsplit(None, 1)
        seg2_words = seg2.split(None, 1)
        if len(seg1_words) == 2 and seg2_words:
            prefix = seg1_words[0]
            last_word = seg1_words[1]
            first_word = seg2_words[0]
            rest = seg2_words[1] if len(seg2_words) > 1 else ""
            joined = last_word + first_word
            seg1 = prefix
            seg2 = (joined + " " + rest).strip() if rest else joined

    # --- Duplicate sentence removal at seam ---
    last_sent = _last_sentence(seg1)
    first_sent = _first_sentence(seg2)
    if last_sent and first_sent and _normalize_for_compare(last_sent) == _normalize_for_compare(first_sent):
        # Remove the duplicate from seg2
        idx = seg2.find(first_sent)
        if idx != -1:
            seg2 = seg2[idx + len(first_sent):].lstrip()

    return (seg1 + "\n\n" + seg2).strip()


__all__ = ["clean_merge_boundary"]
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/ocr/test_boundary_cleanup.py -v`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add ocr/src/transcript_ocr/merging/boundary_cleanup.py tests/ocr/test_boundary_cleanup.py
git commit -m "feat(ocr): add merge boundary text cleanup module"
```

---

### Task 4: Merge confidence filtering + boundary cleanup integration

**Files:**
- Modify: `ocr/src/transcript_ocr/contracts/diagnostics_models.py:108-120`
- Modify: `ocr/src/transcript_ocr/merging/llm_merge.py:515-526`

- [ ] **Step 1: Add `low_confidence_rejections` to diagnostics**

In `ocr/src/transcript_ocr/contracts/diagnostics_models.py`, add to `MergePassDiagnostics` class (after `empty_articles_removed` field, line 117):

```python
    low_confidence_rejections: int = 0
```

- [ ] **Step 2: Add confidence filtering to llm_merge.py**

In `ocr/src/transcript_ocr/merging/llm_merge.py`, add the import at the top (after the existing imports around line 32):

```python
from .boundary_cleanup import clean_merge_boundary
```

Then find the block at lines 515-525 (the `_validate_merge_seam` + `_best_body` calls). Replace the section that builds `merged_body` (lines 515-518):

```python
        if len(bodies) > 1:
            bodies = _validate_merge_seam(client, bodies)

        merged_body = _best_body(bodies)
```

with:

```python
        if len(bodies) > 1:
            # Clean up OCR artifacts at merge join points
            cleaned_bodies = [bodies[0]]
            for i in range(1, len(bodies)):
                cleaned = clean_merge_boundary(cleaned_bodies[-1], bodies[i])
                # Split back — boundary cleanup merges them, but seam validation
                # needs separate segments. Use the cleaned result as new last segment.
                cleaned_bodies[-1] = cleaned
            bodies = cleaned_bodies

            bodies = _validate_merge_seam(client, bodies)

        merged_body = _best_body(bodies)
```

Then find the low-confidence warning block (lines 520-525):

```python
        if len(valid_ids) > 1 and group.confidence < 0.7:
            warning(f"Low-confidence merge ({group.confidence:.1f}): {group.merged_headline}")
```

Replace with confidence filtering:

```python
        merge_min_confidence = float(os.environ.get("MERGE_MIN_CONFIDENCE", "0.5"))
        if len(valid_ids) > 1 and group.confidence < merge_min_confidence:
            warning(f"Rejecting low-confidence merge ({group.confidence:.2f} < {merge_min_confidence}): {group.merged_headline}")
            if md is not None:
                md.low_confidence_rejections += 1
            # Split back into individual articles
            for aid in valid_ids:
                ad = article_data[aid]
                merged_articles.append(
                    MergedArticle(
                        headline=ad["headline"],
                        author=_normalize_byline(ad.get("author", "")),
                        writer_position=ad.get("writer_position", ""),
                        category=ad.get("category", "Campus News"),
                        continues_on=ad["continuation"].get("continues_on", ""),
                        continued_from=ad["continuation"].get("continued_from", ""),
                        body=_strip_continuation_markers(ad["body"]),
                        images=list(ad.get("images", [])),
                        image_files=list(ad.get("image_files", [])),
                        source_pages=[ad["page_label"]],
                    )
                )
            continue
```

Add the `os` import at the top of the file if not already present.

- [ ] **Step 3: Run existing merge tests**

Run: `python -m pytest tests/ocr/test_merging.py tests/ocr/test_merge_helpers.py tests/ocr/test_best_body.py -v`
Expected: All PASS — no regressions.

- [ ] **Step 4: Commit**

```bash
git add ocr/src/transcript_ocr/contracts/diagnostics_models.py ocr/src/transcript_ocr/merging/llm_merge.py
git commit -m "feat(ocr): add merge confidence filtering and boundary cleanup integration"
```

---

### Task 5: Deterministic merge for multi-article continuations

**Files:**
- Modify: `ocr/src/transcript_ocr/merging/deterministic_merge.py`
- Test: `tests/ocr/test_merging.py`

- [ ] **Step 1: Write failing test**

Add to `tests/ocr/test_merging.py` (use the existing import pattern):

```python
def test_deterministic_merge_multi_article_continuation():
    """When 2 articles on page 1 continue to page 5, match by headline similarity."""
    from transcript_ocr.merging.deterministic_merge import _deterministic_merge

    article_data = [
        {"page_label": "1", "headline": "Campus Protest Grows", "body": "Students gathered at the quad...",
         "continuation": {"continues_on": "5", "continued_from": None}},
        {"page_label": "1", "headline": "Student Demands Issued", "body": "A list of demands was presented...",
         "continuation": {"continues_on": "5", "continued_from": None}},
        {"page_label": "5", "headline": "Campus Protest", "body": "The protest continued into the evening...",
         "continuation": {"continues_on": None, "continued_from": "1"}},
        {"page_label": "5", "headline": "Student Demands", "body": "The demands included tuition freeze...",
         "continuation": {"continues_on": None, "continued_from": "1"}},
    ]
    groups = _deterministic_merge(article_data)
    # Should produce 2 groups: [0,2] and [1,3]
    assert len(groups) == 2
    group_sets = [set(g) for g in groups]
    assert {0, 2} in group_sets
    assert {1, 3} in group_sets
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/ocr/test_merging.py::test_deterministic_merge_multi_article_continuation -v`
Expected: FAIL — current code skips multi-article continuations.

- [ ] **Step 3: Implement multi-article matching**

In `ocr/src/transcript_ocr/merging/deterministic_merge.py`, add import at top:

```python
from ..postprocessing.deduplication import _sentence_overlap, _split_sentences
```

Then replace the early skip on line 30 (`if source_counts[page_pair] > 1 or target_counts[...] > 1: continue`) with multi-article matching logic. Replace lines 25-48 (the first `for i in range(n):` loop) with:

```python
    for i in range(n):
        cont_on = article_data[i]["continuation"].get("continues_on")
        if not cont_on:
            continue
        page_pair = (article_data[i]["page_label"], cont_on)

        # Single source → single target: original reciprocal match
        if source_counts[page_pair] <= 1 and target_counts[(cont_on, article_data[i]["page_label"])] <= 1:
            for j in range(n):
                if i == j:
                    continue
                if article_data[j]["page_label"] != cont_on:
                    continue
                cont_from = article_data[j]["continuation"].get("continued_from")
                if cont_from and cont_from == article_data[i]["page_label"]:
                    leader_i = merged_into.get(i, i)
                    leader_j = merged_into.get(j, j)
                    if leader_i != leader_j:
                        for k, v in list(merged_into.items()):
                            if v == leader_j:
                                merged_into[k] = leader_i
                        merged_into[j] = leader_i
                        if i not in merged_into:
                            merged_into[i] = leader_i

    # Multi-article continuations: match by headline + content similarity
    _resolved_multi: set[tuple[str, str]] = set()
    for target_page, count in source_counts.items():
        src_page, dst_page = target_page
        if count <= 1:
            continue
        reverse_key = (dst_page, src_page)
        if target_counts.get(reverse_key, 0) <= 1:
            continue
        if target_page in _resolved_multi:
            continue
        _resolved_multi.add(target_page)

        # Collect source and stub indices
        sources = [i for i in range(n) if article_data[i]["page_label"] == src_page
                    and article_data[i]["continuation"].get("continues_on") == dst_page
                    and i not in merged_into]
        stubs = [j for j in range(n) if article_data[j]["page_label"] == dst_page
                 and article_data[j]["continuation"].get("continued_from") == src_page
                 and j not in merged_into]

        if not sources or not stubs:
            continue

        # Score all pairs by headline similarity + content overlap
        scores: list[tuple[int, int, float]] = []
        for si in sources:
            for sj in stubs:
                score = 0.0
                if _headline_similar(article_data[si]["headline"], article_data[sj]["headline"]):
                    score += 0.6
                src_sents = _split_sentences(article_data[si].get("body", "")[-300:])
                stub_sents = _split_sentences(article_data[sj].get("body", "")[:300])
                if src_sents and stub_sents:
                    score += _sentence_overlap(src_sents, stub_sents) * 0.4
                scores.append((si, sj, score))

        scores.sort(key=lambda x: -x[2])
        used_src: set[int] = set()
        used_stub: set[int] = set()
        for si, sj, score in scores:
            if si in used_src or sj in used_stub:
                continue
            if score < 0.5:
                continue
            # Merge this pair
            leader = merged_into.get(si, si)
            merged_into[sj] = leader
            if si not in merged_into:
                merged_into[si] = leader
            used_src.add(si)
            used_stub.add(sj)
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/ocr/test_merging.py -v`
Expected: All PASS including the new multi-article test.

- [ ] **Step 5: Commit**

```bash
git add ocr/src/transcript_ocr/merging/deterministic_merge.py tests/ocr/test_merging.py
git commit -m "feat(ocr): deterministic merge handles multi-article continuations"
```

---

### Task 6: Byline cleanup improvements

**Files:**
- Modify: `ocr/src/transcript_ocr/postprocessing/byline_cleanup.py`

- [ ] **Step 1: Expand position titles in the regex**

In `ocr/src/transcript_ocr/postprocessing/byline_cleanup.py`, replace the `_POSITION_RE` regex (lines 17-23) with:

```python
_POSITION_RE = re.compile(
    r"\b((?:[\w-]+\s+)?(?:Editor(?:\s+in\s+Chief)?|Staff\s+Writer|Reporter|"
    r"Columnist|Reviewer|Contributing\s+Writer|Associate\s+Editor|"
    r"Managing\s+Editor|(?:News|Features?|Arts?|Sports?|Photo(?:graphy)?)\s+Editor|"
    r"Bureau\s+Chief|Correspondent|Assistant\s+Editor|"
    r"Business\s+Manager|Special\s+to\s+the\s+Transcript|Transcript\s+\w[\w\s]*))\s*$",
    re.IGNORECASE,
)
```

- [ ] **Step 2: Add byline deduplication to `_extract_byline_from_body`**

Add a new function after `_extract_byline_from_body` (before the module-level aliases):

```python
def _dedup_byline_from_body(author: str, body: str) -> str:
    """If body starts with 'By <author>', remove it to prevent duplication."""
    if not author or not body:
        return body
    # Normalize for comparison
    author_clean = re.sub(r"^By\s+", "", author, flags=re.IGNORECASE).strip().lower()
    if not author_clean:
        return body
    lines = body.split("\n", 1)
    first_line = lines[0].strip()
    first_clean = re.sub(r"^By\s+", "", first_line, flags=re.IGNORECASE).strip().lower()
    if first_clean == author_clean or first_clean.startswith(author_clean):
        return lines[1].lstrip("\n") if len(lines) > 1 else ""
    return body
```

Add to the module aliases and `__all__`:

```python
dedup_byline_from_body = _dedup_byline_from_body
```

- [ ] **Step 3: Integrate into llm_merge.py**

In `ocr/src/transcript_ocr/merging/llm_merge.py`, add import:

```python
from ..postprocessing.byline_cleanup import _dedup_byline_from_body
```

After the existing `_extract_byline_from_body` call (around line 532), add:

```python
        merged_body = _dedup_byline_from_body(merged_author, merged_body)
```

- [ ] **Step 4: Run existing tests**

Run: `python -m pytest tests/ocr/ -x`
Expected: All PASS — no regressions.

- [ ] **Step 5: Commit**

```bash
git add ocr/src/transcript_ocr/postprocessing/byline_cleanup.py ocr/src/transcript_ocr/merging/llm_merge.py
git commit -m "feat(ocr): expand position titles and add byline deduplication"
```

---

### Task 7: Preprocessing tuning

**Files:**
- Modify: `ocr/src/transcript_ocr/preprocessing/skew.py:22`
- Modify: `ocr/src/transcript_ocr/preprocessing/image_preprocessor.py:31`
- Modify: `ocr/src/transcript_ocr/config/constants.py:27`

- [ ] **Step 1: Extend skew range**

In `ocr/src/transcript_ocr/preprocessing/skew.py`, change line 22:

```python
    for angle_10x in range(-150, 151):
```

- [ ] **Step 2: Reduce unsharp mask**

In `ocr/src/transcript_ocr/preprocessing/image_preprocessor.py`, change line 31:

```python
    image = image.filter(ImageFilter.UnsharpMask(radius=1.0, percent=50, threshold=3))
```

- [ ] **Step 3: Raise CLAHE clip limit**

In `ocr/src/transcript_ocr/config/constants.py`, change `DOCAI_CLAHE_CLIP_LIMIT`:

```python
DOCAI_CLAHE_CLIP_LIMIT = 3.5
```

- [ ] **Step 4: Run existing tests**

Run: `python -m pytest tests/ocr/ -x`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add ocr/src/transcript_ocr/preprocessing/skew.py ocr/src/transcript_ocr/preprocessing/image_preprocessor.py ocr/src/transcript_ocr/config/constants.py
git commit -m "tune(ocr): extend skew range to ±15°, soften unsharp mask, raise CLAHE clip limit"
```

---

### Task 8: Pre-OCR page quality check

**Files:**
- Modify: `ocr/src/transcript_ocr/preprocessing/image_preprocessor.py`
- Modify: `ocr/src/transcript_ocr/application/page_pipeline.py`

- [ ] **Step 1: Add quality check function**

In `ocr/src/transcript_ocr/preprocessing/image_preprocessor.py`, add after the imports (before `preprocess_image`):

```python
import numpy as np


class PageQualityWarning:
    """Result of a pre-OCR quality check."""
    def __init__(self, is_blank: bool = False, is_low_res: bool = False, is_inverted: bool = False, message: str = ""):
        self.is_blank = is_blank
        self.is_low_res = is_low_res
        self.is_inverted = is_inverted
        self.message = message
        self.should_skip = is_blank


def check_page_quality(image: Image.Image) -> PageQualityWarning:
    """Check image quality before sending to DocAI.

    Returns a PageQualityWarning with skip/warning flags.
    """
    width, height = image.size

    # Low resolution check
    if width < 500 or height < 500:
        return PageQualityWarning(is_low_res=True, message=f"Low resolution: {width}x{height}")

    # Convert to grayscale array for pixel analysis
    gray = np.array(image.convert("L"))

    # Blank page detection: >95% of pixels within 10 values of the mode
    mode_val = int(np.median(gray))  # approximate mode
    within_range = np.sum(np.abs(gray.astype(int) - mode_val) < 10)
    blank_ratio = within_range / gray.size
    if blank_ratio > 0.95:
        return PageQualityWarning(is_blank=True, message=f"Blank page detected ({blank_ratio:.1%} uniform)")

    # Inverted scan detection: median < 64 means mostly dark
    median_val = int(np.median(gray))
    if median_val < 64:
        return PageQualityWarning(is_inverted=True, message=f"Possibly inverted scan (median pixel: {median_val})")

    return PageQualityWarning()
```

- [ ] **Step 2: Integrate into page pipeline**

In `ocr/src/transcript_ocr/application/page_pipeline.py`, add import:

```python
from ..preprocessing.image_preprocessor import check_page_quality
```

In `extract_page_docai()`, after `raw_image = preprocess_image(...)` (line 49), add:

```python
    quality = check_page_quality(_PIL_Image.open(image_path))
    if quality.should_skip:
        warning(f"Skipping {base_name}: {quality.message}")
        if diag is not None:
            diag.error = f"skipped: {quality.message}"
        return None, None, []
    if quality.message:
        warning(f"{base_name}: {quality.message}")
```

Update the return type hint of `extract_page_docai` and update callers in `edition_pipeline.py` to handle `None` results from Phase 1 (check `docai_results[img]` before using).

- [ ] **Step 3: Run tests**

Run: `python -m pytest tests/ocr/ -x`
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add ocr/src/transcript_ocr/preprocessing/image_preprocessor.py ocr/src/transcript_ocr/application/page_pipeline.py
git commit -m "feat(ocr): add pre-OCR page quality check (blank, low-res, inverted detection)"
```

---

### Task 9: Eliminate preprocessing + YOLO duplication

**Files:**
- Modify: `ocr/src/transcript_ocr/recognition/page_extractor.py:32-47`
- Modify: `ocr/src/transcript_ocr/application/page_pipeline.py:82-109`

- [ ] **Step 1: Modify `process_page_with_docai` to accept preprocessed inputs**

In `ocr/src/transcript_ocr/recognition/page_extractor.py`, change the function signature and remove duplicate calls. Replace lines 32-49:

```python
def process_page_with_docai(
    client,
    image_path: str,
    docai_result,
    preprocessed_image: Image.Image,
    regions: list[tuple[int, int, int, int]],
    diag: PageDiagnostics | None = None,
    snapshots_dir: str | None = None,
) -> tuple[PageContent, Image.Image, list[tuple[int, int, int, int]]]:
    """
    Send a preprocessed page image to Gemini for structuring, with OCR text pre-extracted
    by Document AI. Gemini structures the provided text into articles/ads — it does not
    re-read characters off the image.

    Uses the preprocessed image and regions from Phase 1 — does NOT reprocess.
    """
    image = preprocessed_image
```

Remove the old lines that called `preprocess_image()` and `detect_image_regions()` (the old lines 44-49).

Also remove the now-unused import `from ..preprocessing.image_preprocessor import preprocess_image` and `from ..detection.yolo_provider import detect_image_regions` from this file.

- [ ] **Step 2: Update `structure_and_link_page` to pass Phase 1 results**

In `ocr/src/transcript_ocr/application/page_pipeline.py`, update the call at line 103:

```python
        page_content, _gemini_image, _gemini_regions = process_page_with_docai(
            client,
            image_path,
            docai_result,
            preprocessed_image,
            regions,
            diag=diag,
            snapshots_dir=snapshots_dir,
        )
```

- [ ] **Step 3: Run existing tests**

Run: `python -m pytest tests/ocr/ -x`
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add ocr/src/transcript_ocr/recognition/page_extractor.py ocr/src/transcript_ocr/application/page_pipeline.py
git commit -m "perf(ocr): eliminate duplicate preprocessing and YOLO detection in Phase 2"
```

---

### Task 10: Graceful page skip in Phase 1

**Files:**
- Modify: `ocr/src/transcript_ocr/application/edition_pipeline.py:114-161`

- [ ] **Step 1: Replace fail-fast with graceful skip**

In `ocr/src/transcript_ocr/application/edition_pipeline.py`, replace the Phase 1 error handling block (lines 118-161). Change the `except` blocks inside the futures loop to NOT cancel other futures and NOT break:

Replace lines 124-142:

```python
                except DocAIError as exc:
                    page_diag = PageDiagnostics()
                    page_diag.docai_status = f"failed: {exc}"
                    page_diag.error = str(exc)
                    page_diag_map[img] = page_diag
                    error(f"DocAI failed on {os.path.basename(img)}: {exc} — skipping page")
                except Exception as exc:
                    page_diag = PageDiagnostics()
                    page_diag.error = str(exc)
                    page_diag_map[img] = page_diag
                    error(f"Phase 1 failed on {os.path.basename(img)}: {exc} — skipping page")
```

Remove the `phase1_error`/`phase1_error_img` variables and the entire abort block (lines 144-161). Replace with:

```python
    phase1_succeeded = len(docai_results)
    phase1_failed = len(image_files) - phase1_succeeded
    if phase1_failed > 0:
        warning(f"Phase 1: {phase1_failed}/{len(image_files)} pages failed — continuing with {phase1_succeeded} pages")
    if phase1_succeeded == 0:
        error("All pages failed in Phase 1 — aborting edition")
        report.page_diagnostics.extend(page_diag_map.values())
        report.total_time_seconds = time.time() - pipeline_start
        report.finalize()
        _write_diagnostics_and_issues(report, edition_ocr_output, edition_output, snapshots_dir, "")
        return

    success(f"Phase 1 done: {phase1_succeeded}/{len(image_files)} pages extracted via DocAI")
```

Also handle `None` results from quality check in Phase 2 — in `_run_phase2_page`, check if the image is in `docai_results`:

```python
    def _run_phase2_page(img: str) -> tuple[str, PageDiagnostics, Any]:
        if img not in docai_results:
            return img, page_diag_map.get(img, PageDiagnostics()), None
        docai_result, preprocessed_image, regions = docai_results[img]
        page_diag = page_diag_map[img]
        result = structure_and_link_page(
            client, img, docai_result, preprocessed_image, regions,
            edition_output, diag=page_diag, ocr_output_dir=edition_ocr_output,
            snapshots_dir=snapshots_dir,
        )
        return img, page_diag, result
```

- [ ] **Step 2: Run existing tests**

Run: `python -m pytest tests/ocr/ -x`
Expected: All PASS.

- [ ] **Step 3: Commit**

```bash
git add ocr/src/transcript_ocr/application/edition_pipeline.py
git commit -m "fix(ocr): graceful page skip instead of fail-fast on DocAI errors"
```

---

### Task 11: Prompt improvements

**Files:**
- Modify: `ocr/src/transcript_ocr/recognition/prompts.py`

- [ ] **Step 1: Add rules to DOCAI_SYSTEM_PROMPT**

In `ocr/src/transcript_ocr/recognition/prompts.py`, add the following rules to the `DOCAI_SYSTEM_PROMPT` string. Insert them before the `Read columns top-to-bottom` line (currently line 107):

```python
LETTERS TO THE EDITOR: Each Letter to the Editor is a SEPARATE article. Letters typically end with a signature line (a dash or newline followed by a name, e.g. "- John Smith"). When you see a new salutation ("Editor, the Transcript:") or a new signature followed by a new heading, start a new article. Do not combine multiple signed letters into one article, even if they appear in the same column under a shared heading like "Letters" or "Mail".

CONTINUATION FIELD FORMAT: The `continues_on` and `continued_from` fields must contain ONLY a page number as digits (e.g., "5"). If the source text says "Back Page", "next page", or similar phrases, set the field to "?" — never include textual descriptions.

SYNDICATED CONTENT: Syndicated humor or entertainment columns (nationally distributed content, often with embedded product mentions, sponsor attributions, or copyright notices like "(C) 1960 Author Name") are "Arts & Entertainment", not "Campus News".

LOGOS AND SEALS: Organization logos, newspaper association seals, award emblems, and masthead graphics should go in `other_content` with a descriptive title, not as articles.
```

- [ ] **Step 2: Simplify MERGE_PROMPT**

Replace the entire `MERGE_PROMPT` string (lines 39-71) with:

```python
MERGE_PROMPT = """\
You are analyzing newspaper articles extracted from individual pages of a single edition.
Some articles start on one page and continue on another.

Below is a numbered list of articles with their page, headline, author, continuation references, and a preview. Your task is to return ONLY grouping decisions — which articles should be merged.

Rules:
1. Merge ONLY when there is clear evidence of continuation: explicit "Continued on/from page X" references matching the other article's page, matching headlines across pages, or a stub (headline with "---"/"..." prefix) paired with its source. Tolerate OCR misspellings in continuation markers (e.g., "Continuted" for "Continued", "(. 1)" for "(p. 1)").
2. NEVER merge articles that both have distinct, substantive headlines — even if on similar topics. Example: "Scots Spoil Homecoming" and "Bishops Hurt By Mistakes" are SEPARATE articles.
3. NEVER merge a photo-only entry (body is just a caption, <100 chars) into an article body. Photo captions should remain as standalone entries.
4. Every article must appear in exactly one group (even single-article groups).
5. When multiple articles on the SAME page reference the SAME continuation page, match them 1:1 by headline and content similarity. Read the CONTENT of each preview carefully — pair by semantic match, not by order.
6. For EVERY group, set a "confidence" score between 0.0 and 1.0:
   - 1.0 = reciprocal explicit markers (both sides reference each other's page)
   - 0.8-0.9 = one-sided explicit marker with matching headline or content
   - 0.5-0.7 = ambiguous match based on content similarity alone
   - Below 0.5 = very uncertain, should probably remain separate
   Single-article groups (no merge) should have confidence 1.0.
"""
```

- [ ] **Step 3: Run existing tests**

Run: `python -m pytest tests/ocr/ -x`
Expected: All PASS — prompts are strings, no logic changed.

- [ ] **Step 4: Commit**

```bash
git add ocr/src/transcript_ocr/recognition/prompts.py
git commit -m "improve(ocr): add letter splitting, syndicated column, and logo rules to prompts; simplify merge prompt"
```

---

### Task 12: Full regression test

- [ ] **Step 1: Run the complete OCR test suite**

Run: `python -m pytest tests/ocr/ -v`
Expected: All tests PASS.

- [ ] **Step 2: Run the architecture boundary tests**

Run: `python -m pytest tests/ocr/architecture/ -v`
Expected: All PASS — no import rule violations.

- [ ] **Step 3: Verify with a real edition (if available)**

If `ocr/inbox/1960-01-13/` has TIF files:

```bash
scripts/ocr/process-edition.sh "ocr/inbox/1960-01-13" --keep-source --run-id quality-overhaul
```

Then compare `public/editions/1960-01-13/edition.json` to verify:
- Letters to the editor are split into separate articles
- No "Back Page" in continuation fields (should be "?" or numeric)
- Syndicated columns categorized as "Arts & Entertainment"
- No duplicate preprocessing warnings in logs

- [ ] **Step 4: Commit any test fixes**

```bash
git add -A
git commit -m "test(ocr): verify quality overhaul with full regression suite"
```
