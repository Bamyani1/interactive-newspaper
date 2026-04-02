# OCR Skill Master Plan: `transcript-ocr`

## Overview

This skill replaces the Gemini-powered parts of the existing OCR pipeline with Claude's vision. The existing Python pipeline uses DocAI for text extraction, Gemini for structuring/merging/enrichment, and YOLO for image detection. This skill keeps YOLO and the image cropping code, but replaces everything Gemini and DocAI did with Claude looking directly at page scans.

The result: Claude reads scanned newspaper pages, extracts all content, structures it into the exact `edition.json` schema, handles cross-page article merging, enriches ads inline, and validates its own output.

---

## Pipeline Phases

### Phase 1: Setup & Preprocessing

**What happens:** Discover scan files, convert TIFs if needed, sort into page order.

**Who handles it:** A bundled Python script (`scripts/preprocess.py`) that reuses existing pipeline utilities.

**Details:**
- Input: A folder path containing scan files (TIF, TIFF, JPG, PNG)
- Discovery: Use glob with `IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".tif", ".tiff")` (from `config/constants.py`)
- TIF handling: PIL/Pillow opens TIF natively — no conversion needed for YOLO detection. But Claude cannot view TIF files directly. The script converts any TIF/TIFF to JPG (95% quality) in a temp directory so Claude can view them.
- Page ordering: Sort by filename (filenames follow pattern `0001_Page 1.tif`, `0002_Page 2.tif`, etc.)
- Quality check: Reuse `check_page_quality()` from `preprocessing/image_preprocessor.py` — skip blank pages (>95% uniform pixels), warn on low-res (<500px) or inverted (median pixel < 64)
- Preprocessing: Reuse `preprocess_image()` for deskewing, contrast enhancement, sharpening — these improve Claude's reading accuracy too

**Output:** Ordered list of preprocessed page images (JPG), ready for YOLO and Claude.

---

### Phase 2: YOLO Region Detection + Image Cropping

**What happens:** Run YOLO on each page to find image regions, crop them out as separate files.

**Who handles it:** The bundled `scripts/preprocess.py` script, calling existing pipeline code.

**Existing code reused:**
- `detection/yolo_provider.py` → `detect_image_regions(image)` — returns `list[tuple[y1, x1, y2, x2]]`
- `image_linking/cropper.py` → `crop_and_save_images(image, regions, output_dir, page_stem)` — saves JPEGs to `images/` subdirectory, returns `{region_idx: relative_path}`
- YOLO model: `doclayout_yolo_docstructbench_imgsz1024.pt` (auto-downloads from HuggingFace if missing)
- Detection config: conf=0.3, only "figure" class, area 15000px²–80% of page, aspect 0.25–4.0, IoU dedup 0.5

**Output per page:**
- Cropped image files in `{output_dir}/images/{page_stem}_img1.jpg`, etc.
- Detection manifest: JSON mapping page → list of regions with their cropped file paths

**Output overall:** All cropped images in the output `images/` directory, plus a detection manifest JSON that Claude reads in Phase 3.

---

### Phase 3: Per-Page OCR with Claude (CORE PHASE)

**What happens:** Claude looks at each page scan and extracts all structured content.

**Who handles it:** Claude directly, guided by the skill instructions.

**Input per page:**
- The full page scan image (JPG, viewable by Claude)
- The YOLO detection manifest for that page (which regions were found, where)
- The cropped images from that page (so Claude can examine them closely)

**What Claude extracts per page:**

1. **Articles** — For each article on the page:
   - `headline`: str (exact text as printed)
   - `author`: str (byline, empty string if none)
   - `writer_position`: str (e.g., "Transcript Editor", empty if none)
   - `category`: exactly one of "Campus News", "News", "Sports", "Arts & Entertainment", "Opinion"
   - `continues_on`: str (page number if article continues, empty if not)
   - `continued_from`: str (page number if continued from elsewhere, empty if not)
   - `body`: str (full article text, exact as printed, paragraphs separated by \n\n)
   - `images`: list of `{caption: str, position: str}` for images belonging to this article
   - `image_files`: list of relative paths to cropped images (from YOLO manifest)
   - `page_number`: str (this page's number, used later for source_pages)

2. **Ads** — For each ad on the page:
   - `business_name`: str
   - `body`: str (full ad text)
   - `image_files`: list of relative paths to cropped images

3. **Enriched Ads (inline)** — For each ad, also extract:
   - `category`: one of "Food & Drink", "Entertainment", "Services", "Retail", "Greek Life", "Jobs", "Housing", "Education", "Events", "Other"
   - `ad_type`: "display" or "classified"
   - `display_text`: str (human-readable summary of the ad)
   - `phone`: str (phone number if present, empty if not)
   - `address`: str (address if present, empty if not)
   - `price`: str (price info if present, empty if not)

4. **Other Content** — Mastheads, column headers, standings tables, notices, filler photos with captions:
   - `title`: str (optional, empty if none)
   - `body`: str (required)

**Critical accuracy requirements:**
- Read every word carefully. The previous pipeline garbled text in multi-column layouts, mixed up article boundaries, and misread words.
- Preserve exact spelling of proper nouns (names, places, organizations).
- For genuinely illegible text, mark it with [illegible] rather than guessing.
- Multi-column pages: identify column boundaries and read each column separately, top to bottom.
- Article boundaries: look for headlines, bylines, column rules, and whitespace to determine where one article ends and another begins.
- Continuation markers: look for "(Continued on page X)", "(Continued from page X)", "(See page X)", "(Turn to page X)", and similar text at the end or beginning of articles.

**Image-to-article matching:**
- Claude receives the YOLO-cropped images and the detection manifest.
- Claude must determine which cropped image belongs to which article or ad by examining spatial proximity on the page and reading any captions near the image.
- Each image gets a caption (read from the page near the image) and a position descriptor (e.g., "upper-center", "center-left").
- images[] and image_files[] must be index-aligned: images[0].caption describes image_files[0].

**Output per page:** A JSON object with `articles`, `ads`, `enriched_ads`, `other_content` arrays for that page.

---

### Phase 4: Cross-Page Article Merging

**What happens:** Claude reviews all per-page results together and merges articles that continue across pages.

**Who handles it:** Claude directly, after all pages are processed.

**Input:** All per-page JSON results from Phase 3.

**Process:**
1. Collect all articles from all pages with their page numbers.
2. Identify continuation pairs:
   - Article on page X has `continues_on: "Y"` → look for article on page Y with `continued_from: "X"` or matching headline.
   - Also check for content continuity: article body ends mid-sentence on one page, continues mid-sentence on another.
3. Merge matched pairs:
   - Combine body text (page 1 text first, then page 2 text, separated by \n\n).
   - Use the headline from the first page (unless the continuation page has a more complete headline).
   - Merge source_pages: ["1", "12"] for an article spanning pages 1 and 12.
   - Keep the continuation metadata: continues_on and continued_from reflect the original markers.
   - Merge images from both pages.
   - Author, writer_position, category: take from whichever page has them.
4. Non-continuation articles become single-page entries with source_pages: ["N"].
5. Normalize continuation fields:
   - Empty string "" → keep
   - Numeric string like "1", "12" → keep
   - Anything else ("Back Page", "next page", etc.) → becomes "?"

**Output:** Final merged article list, plus collected ads, enriched_ads, and other_content from all pages (deduplicated).

---

### Phase 5: Assembly & Output

**What happens:** Assemble the final edition.json and copy images to the output directory.

**Who handles it:** A bundled Python script (`scripts/assemble.py`).

**Process:**
1. Build the final JSON structure:
   ```json
   {
     "edition_date": "YYYY-MM-DD",
     "publication_info": "extracted from masthead",
     "articles": [ ...MergedArticle ],
     "ads": [ ...Ad ],
     "enriched_ads": [ ...EnrichedAd ],
     "other_content": [ ...OtherContent ]
   }
   ```
2. Ensure ads and enriched_ads are in the same order with matching business_name values.
3. Ensure all image_files paths are relative: `images/<filename>.jpg`.
4. Ensure images[] and image_files[] are index-aligned on every article.
5. Write `edition.json` to `public/editions/<date>/` with 2-space indent.
6. Copy all cropped images to `public/editions/<date>/images/`.

---

### Phase 6: Self-Audit

**What happens:** Validate the output against the schema contract.

**Who handles it:** A bundled Python script (`scripts/validate.py`).

**Checks:**
- [ ] All articles have valid categories (from ARTICLE_CATEGORIES)
- [ ] All continuation fields are empty, numeric, or "?"
- [ ] images[] and image_files[] same length on every article
- [ ] All referenced image files exist on disk
- [ ] ads count == enriched_ads count
- [ ] ads[i].business_name == enriched_ads[i].business_name for all i
- [ ] All enriched_ad categories from AD_ENRICHMENT_CATEGORIES
- [ ] All enriched_ad ad_types are "display" or "classified"
- [ ] No control characters in any text fields (articles, ads, other_content)
- [ ] edition_date is valid ISO date
- [ ] publication_info is non-empty
- [ ] At least 1 article exists
- Print pass/fail for each check + summary

---

## What Existing Python Code Is Reused vs What Claude Replaces

### Reused (orchestrated by bundled scripts):

| Component | Location | What it does |
|-----------|----------|--------------|
| Image preprocessing | `preprocessing/image_preprocessor.py` | Deskew, contrast, sharpen |
| Quality checks | `preprocessing/image_preprocessor.py` | Blank/low-res/inverted detection |
| YOLO detection | `detection/yolo_provider.py` | Find image regions on page |
| Region filtering | `detection/region_filters.py` | Remove noise, dedup overlaps |
| Image cropping | `image_linking/cropper.py` | Crop regions to separate files |
| Image discovery | `ingestion/discovery.py` | Find scan files in folder |
| Skew detection | `preprocessing/skew.py` | Detect rotation angle |

### Replaced by Claude:

| Old Component | What it did | Now done by |
|---------------|------------|-------------|
| Document AI (DocAI) | Raw text extraction from scans | Claude vision |
| Gemini structuring | Convert raw text → articles/ads/other | Claude vision + reasoning |
| Gemini image matching | Assign image regions to articles | Claude vision |
| Gemini merge decisions | Decide which articles to merge | Claude reasoning |
| Gemini merge seam repair | Fix garbled text at merge points | Claude reasoning |
| Gemini ad enrichment | Extract category/phone/address/price | Claude (inline during Phase 3) |
| Gemini proper noun correction | Fix OCR'd names across pages | Claude (during Phase 4) |

---

## Edge Cases and Known Failure Modes

From the gold-edition audit log and pipeline analysis:

### Text Accuracy Issues
1. **Multi-column confusion:** Gemini would read across columns instead of down them, garbling article text. Claude must be explicitly told to identify column boundaries first.
2. **OCR typos:** "accordirly" → "accordingly", "chosed" → "chosen", "as week as" → "as weak as", "inlvolved" → "involved", "Oucome" → "Outcome". Claude should use contextual understanding to catch these.
3. **Proper noun corruption:** Names can be misread across pages (e.g., "Mohahan" vs "Monahan"). Claude should cross-reference names when merging.

### Structural Issues
4. **Wrong categories:** Articles miscategorized (e.g., fraternity news as "News" instead of "Campus News", arts column as "Opinion" instead of "Arts & Entertainment").
5. **Image-article mismatch:** Tom Eibel article had action shot caption paired with portrait and vice versa. Claude must look at the actual image content, not just spatial proximity.
6. **Duplicate other_content:** Same content extracted twice from overlapping regions.

### Continuation/Merge Issues
7. **"Back Page" normalization:** The string "Back Page" appeared in continues_on instead of "?" or "12". Any non-numeric continuation value must become "?".
8. **Garbled merge seams:** Where pages join, text can be garbled if the continuation point isn't cleanly identified. Articles 0, 4, 14 in the gold file have this issue.
9. **Standalone photos:** Some pages have photos with captions but no associated article (e.g., the Circle K painting photo on page 3). These should become other_content items.

### Encoding Issues
10. **Special characters:** Box-drawing │ appearing instead of bullet ●, control char \u0002 instead of ¢ sign. Claude should use contextual understanding to pick the right character.

---

## Output Schema (Field-by-Field)

### Top Level
```
edition_date: string       — "YYYY-MM-DD" format
publication_info: string   — Masthead text (newspaper name, volume, date, price)
articles: MergedArticle[]  — All articles (merged if multi-page)
ads: Ad[]                  — Raw ad extractions
enriched_ads: EnrichedAd[] — Same ads with metadata (same count, same order)
other_content: OtherContent[] — Non-article, non-ad content
```

### MergedArticle
```
headline: string           — Exact headline text as printed
author: string             — Byline name, "" if none
writer_position: string    — Role title (e.g., "Sports Editor"), "" if none
category: string           — Exactly one of: "Campus News", "News", "Sports", "Arts & Entertainment", "Opinion"
continues_on: string       — "", numeric page string, or "?"
continued_from: string     — "", numeric page string, or "?"
body: string               — Full article text, paragraphs separated by \n\n
images: ArticleImage[]     — Captions and positions for images
image_files: string[]      — Relative paths: "images/0001_Page 1_img1.jpg"
source_pages: string[]     — Page numbers as strings: ["1"], ["1", "12"], etc.
```

### ArticleImage
```
caption: string            — Full caption text including photo credit
position: string           — Spatial position on page (e.g., "upper-center", "center-left"), "" if unknown
```

### Ad
```
business_name: string      — Business or advertiser name
body: string               — Full ad text
image_files: string[]      — Relative paths to ad images, [] if none
```

### EnrichedAd
```
business_name: string      — Must match corresponding Ad
body: string               — Must match corresponding Ad
image_files: string[]      — Must match corresponding Ad
category: string           — One of: "Food & Drink", "Entertainment", "Services", "Retail", "Greek Life", "Jobs", "Housing", "Education", "Events", "Other"
ad_type: string            — "display" or "classified"
display_text: string       — Human-readable ad summary
phone: string              — Phone number if present, "" if not
address: string            — Address if present, "" if not
price: string              — Price info if present, "" if not
```

### OtherContent
```
title: string              — Title/heading, "" if none (optional)
body: string               — Content text (required, non-empty)
```

---

## Parallel Edition Processing

When the user provides multiple editions:
- The skill spawns one subagent per edition using the Agent tool.
- Each agent handles its edition independently through all 6 phases.
- The main (coordinator) agent tracks progress and reports as editions complete.
- Agents do NOT share state — each works in its own output directory.

---

## Dependencies

The bundled scripts require:
- Python 3.x with PIL/Pillow (for TIF conversion, image preprocessing)
- The `ocr/.venv/` virtual environment with `doclayout-yolo`, `scipy`, `Pillow` installed
- YOLO model weights (auto-download from HuggingFace on first run)
- No Gemini API key needed (Claude replaces all Gemini calls)
- No DocAI credentials needed (Claude replaces DocAI)

---

## File Naming Convention

Image files follow the pattern: `{page_number_padded}_Page {N}_img{M}.jpg`
- Page number padded to 4 digits: `0001`, `0002`, etc.
- Image number starts at 1: `img1`, `img2`, etc.
- Example: `0003_Page 3_img2.jpg` = page 3, second detected image

Edition output directory: `public/editions/YYYY-MM-DD/`
